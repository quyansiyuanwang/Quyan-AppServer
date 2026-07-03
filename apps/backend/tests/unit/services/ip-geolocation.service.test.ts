import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { IpGeolocationService } from "../../../src/services/infrastructure/ip-geolocation.service";
import { RedisService } from "../../../src/services/infrastructure/redis.service";

vi.mock("../../../src/config/env", () => ({
  EnvSpace: {
    baiduMapConfig: {
      ipLocationAk: "test-ak",
    },
  },
}));

vi.mock("axios");
vi.mock("../../../src/services/infrastructure/redis.service");

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
};

describe("IpGeolocationService", () => {
  let service: IpGeolocationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redisMock as unknown as RedisService);
    // 重置单例
    (IpGeolocationService as any).instance = undefined;
    service = IpGeolocationService.getInstance();
    // 注入 mock redis
    (service as any).redis = redisMock;
  });

  describe("本地 IP 快速返回", () => {
    it("127.0.0.1 应返回 '本地网络'", async () => {
      const result = await service.getLocation("127.0.0.1");
      expect(result).toBe("本地网络");
      expect(redisMock.get).not.toHaveBeenCalled();
    });

    it("::1 (IPv6 loopback) 应返回 '本地网络'", async () => {
      expect(await service.getLocation("::1")).toBe("本地网络");
    });

    it("192.168.x.x 应返回 '本地网络'", async () => {
      expect(await service.getLocation("192.168.1.100")).toBe("本地网络");
    });

    it("10.x.x.x 应返回 '本地网络'", async () => {
      expect(await service.getLocation("10.0.0.1")).toBe("本地网络");
    });

    it("空字符串应返回 '本地网络'", async () => {
      expect(await service.getLocation("")).toBe("本地网络");
    });
  });

  describe("Redis 缓存命中", () => {
    it("缓存命中时应直接返回缓存值，不调用 Baidu API", async () => {
      redisMock.get.mockResolvedValue("北京市");

      const result = await service.getLocation("8.8.8.8");

      expect(result).toBe("北京市");
      expect(redisMock.get).toHaveBeenCalledWith("ip:geo:8.8.8.8");
      expect(axios.get).not.toHaveBeenCalled();
    });

    it("缓存返回空字符串时应视为未命中，继续查询 API", async () => {
      redisMock.get.mockResolvedValue(null);
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 0, content: { address: "上海市" } },
      });
      redisMock.set.mockResolvedValue(undefined);

      const result = await service.getLocation("1.2.3.4");
      expect(result).toBe("上海市");
    });
  });

  describe("Baidu API 查询", () => {
    beforeEach(() => {
      redisMock.get.mockResolvedValue(null);
      redisMock.set.mockResolvedValue(undefined);
    });

    it("API 返回有效 location 时应返回该值并写入缓存", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 0, content: { address: "广东省深圳市" } },
      });

      const result = await service.getLocation("14.215.177.38");

      expect(result).toBe("广东省深圳市");
      expect(redisMock.set).toHaveBeenCalledWith("ip:geo:14.215.177.38", "广东省深圳市", 7 * 24 * 60 * 60);
    });

    it("API status 非 '0' 时应返回 '未知地区'", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 1 },
      });

      const result = await service.getLocation("1.1.1.1");
      expect(result).toBe("未知地区");
    });

    it("API content 缺失时应返回 '未知地区'", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 0 },
      });

      expect(await service.getLocation("1.1.1.1")).toBe("未知地区");
    });

    it("API address 为空字符串时应返回 '未知地区'", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 0, content: { address: "   " } },
      });

      expect(await service.getLocation("1.1.1.1")).toBe("未知地区");
    });

    it("API address 缺失时应回退到 address_detail 拼接", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          status: 0,
          content: {
            address_detail: {
              province: "北京市",
              city: "北京市",
              district: "",
            },
          },
        },
      });

      expect(await service.getLocation("1.1.1.1")).toBe("北京市北京市");
    });

    it("API 请求抛出异常时应返回 '未知地区'（fail-open）", async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error("Network timeout"));

      const result = await service.getLocation("1.1.1.1");
      expect(result).toBe("未知地区");
    });

    it("address 值应 trim 首尾空格", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 0, content: { address: "  北京市  " } },
      });

      expect(await service.getLocation("1.1.1.1")).toBe("北京市");
    });
  });

  describe("Redis 故障降级", () => {
    it("Redis get 抛出异常时应继续查询 API（fail-open）", async () => {
      redisMock.get.mockRejectedValue(new Error("Redis connection refused"));
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 0, content: { address: "浙江省杭州市" } },
      });
      redisMock.set.mockResolvedValue(undefined);

      const result = await service.getLocation("47.96.0.1");
      expect(result).toBe("浙江省杭州市");
    });

    it("Redis set 抛出异常时不应影响返回值", async () => {
      redisMock.get.mockResolvedValue(null);
      vi.mocked(axios.get).mockResolvedValue({
        data: { status: 0, content: { address: "四川省成都市" } },
      });
      redisMock.set.mockRejectedValue(new Error("Redis write failed"));

      const result = await service.getLocation("61.139.2.69");
      expect(result).toBe("四川省成都市");
    });
  });

  describe("单例模式", () => {
    it("getInstance 应返回同一实例", () => {
      (IpGeolocationService as any).instance = undefined;
      const a = IpGeolocationService.getInstance();
      const b = IpGeolocationService.getInstance();
      expect(a).toBe(b);
    });
  });
});
