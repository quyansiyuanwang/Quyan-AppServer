import { Decimal } from "@prisma/client/runtime/library";
import { BALANCE_MANAGEMENT_POLICY, type BalanceOverdraftRule } from "@quyan/shared";

type Node = { value: string } | { op: string; args: Node[] };
const variables = ["totalRecharged", "totalUsed", "fixedAmount", "percent"] as const;
type Variables = Record<(typeof variables)[number], Decimal.Value>;

/** A deliberately small arithmetic grammar. It never evaluates JavaScript or property access. */
export function parseOverdraftFormula(expression: string): Node {
  if (!expression.trim() || expression.length > BALANCE_MANAGEMENT_POLICY.formulaLength)
    throw new Error("Invalid formula length");
  const tokens = expression.match(/(?:\d+(?:\.\d+)?|\.\d+)|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g) ?? [];
  let index = 0;
  let count = 0;
  const node = (value: Node) => {
    if (++count > BALANCE_MANAGEMENT_POLICY.formulaNodes) throw new Error("Formula is too complex");
    return value;
  };
  const expect = (token: string) => {
    if (tokens[index++] !== token) throw new Error("Invalid formula token");
  };
  const primary = (depth: number): Node => {
    if (depth > BALANCE_MANAGEMENT_POLICY.formulaDepth) throw new Error("Formula is too deep");
    const token = tokens[index++];
    if (token === "+" || token === "-")
      return node({ op: token === "+" ? "positive" : "negative", args: [primary(depth + 1)] });
    if (token === "(") {
      const result = expressionNode(depth + 1);
      expect(")");
      return result;
    }
    if (!token) throw new Error("Incomplete formula");
    if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token) || variables.includes(token as (typeof variables)[number]))
      return node({ value: token });
    if (!["min", "max", "abs", "round"].includes(token)) throw new Error("Unknown formula name");
    expect("(");
    const args = [expressionNode(depth + 1)];
    while (tokens[index] === ",") {
      index++;
      args.push(expressionNode(depth + 1));
    }
    expect(")");
    if ((["abs", "round"].includes(token) && args.length !== 1) || (["min", "max"].includes(token) && args.length < 2))
      throw new Error("Invalid function arguments");
    return node({ op: token, args });
  };
  const product = (depth: number): Node => {
    let left = primary(depth);
    while (tokens[index] === "*" || tokens[index] === "/") {
      const op = tokens[index++]!;
      left = node({ op, args: [left, primary(depth)] });
    }
    return left;
  };
  const expressionNode = (depth: number): Node => {
    let left = product(depth);
    while (tokens[index] === "+" || tokens[index] === "-") {
      const op = tokens[index++]!;
      left = node({ op, args: [left, product(depth)] });
    }
    return left;
  };
  const result = expressionNode(0);
  if (index !== tokens.length) throw new Error("Unexpected formula token");
  return result;
}

export function evaluateOverdraftFormula(expression: string, values: Variables): Decimal {
  const visit = (node: Node): Decimal => {
    if ("value" in node)
      return new Decimal(Object.hasOwn(values, node.value) ? values[node.value as keyof Variables] : node.value);
    const args = node.args.map(visit);
    const first = args[0]!;
    let result: Decimal;
    switch (node.op) {
      case "+":
        result = first.plus(args[1]!);
        break;
      case "-":
        result = first.minus(args[1]!);
        break;
      case "*":
        result = first.times(args[1]!);
        break;
      case "/":
        if (args[1]!.isZero()) throw new Error("Division by zero");
        result = first.div(args[1]!);
        break;
      case "negative":
        result = first.negated();
        break;
      case "positive":
        result = first;
        break;
      case "min":
        result = Decimal.min(...args);
        break;
      case "max":
        result = Decimal.max(...args);
        break;
      case "abs":
        result = first.abs();
        break;
      case "round":
        result = first.toDecimalPlaces(BALANCE_MANAGEMENT_POLICY.decimals, Decimal.ROUND_HALF_UP);
        break;
      default:
        throw new Error("Invalid operator");
    }
    if (!result.isFinite() || result.abs().gt("1e30")) throw new Error("Formula overflow");
    return result;
  };
  return visit(parseOverdraftFormula(expression));
}

export function calculateOverdraftLimit(
  rule: BalanceOverdraftRule,
  account: { totalRecharged: Decimal.Value; totalUsed: Decimal.Value },
): Decimal {
  if (rule.mode === "disabled") return new Decimal(0);
  const totalRecharged = Decimal.max(0, account.totalRecharged);
  const totalUsed = Decimal.max(0, account.totalUsed);
  const fixed = new Decimal(rule.fixedAmount);
  const percentage = totalRecharged.times(rule.percent).div(100);
  let value: Decimal;
  switch (rule.mode) {
    case "fixed":
      value = fixed;
      break;
    case "percent":
      value = percentage;
      break;
    case "sum":
      value = fixed.plus(percentage);
      break;
    case "max":
      value = Decimal.max(fixed, percentage);
      break;
    case "min":
      value = Decimal.min(fixed, percentage);
      break;
    case "formula":
      value = evaluateOverdraftFormula(rule.formula, {
        totalRecharged,
        totalUsed,
        fixedAmount: fixed,
        percent: rule.percent,
      });
      break;
    default:
      throw new Error("Invalid overdraft mode");
  }
  if (!value.isFinite() || value.abs().gt(BALANCE_MANAGEMENT_POLICY.maximumAmount))
    throw new Error("Overdraft amount out of range");
  value = Decimal.max(0, rule.minimum, value);
  if (rule.maximum !== null) value = Decimal.min(value, rule.maximum);
  return value.toDecimalPlaces(BALANCE_MANAGEMENT_POLICY.decimals, Decimal.ROUND_FLOOR);
}
