/** Trusted keys/arguments only. One Redis operation preserves the legacy set/reset distinction. */
export const IP_ERROR_WEIGHT_WRITE_SCRIPT = `
  local operation = ARGV[1]
  local weight = tonumber(ARGV[2])
  local timestamp = tonumber(ARGV[3])
  if operation ~= 'set' and operation ~= 'reset' then return 0 end
  if not weight or weight < 0 or weight ~= math.floor(weight) then return 0 end
  if not timestamp or timestamp <= 0 or timestamp ~= math.floor(timestamp) then return 0 end
  redis.call('del', KEYS[1], KEYS[2])
  if operation == 'reset' then
    redis.call('del', KEYS[3], KEYS[4])
  elseif weight > 0 then
    redis.call('set', KEYS[1], ARGV[2])
    redis.call('set', KEYS[2], ARGV[3])
  end
  return 1
`;
export type IpErrorWeightWrite = { kind: "reset" } | { kind: "set"; weight: number };
