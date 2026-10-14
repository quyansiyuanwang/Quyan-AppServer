import { Prisma } from "@prisma/client";
import { iamAccountDenied } from "../users/iam-account-principal";
const identifier = (name: string) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw iamAccountDenied();
  return Prisma.raw("`" + name + "`");
};
export function platformScalarColumns(modelName: string, alias: string, selected?: readonly string[]) {
  const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === modelName);
  if (!model) throw iamAccountDenied();
  const fields = model.fields.filter(
    (field) => field.kind !== "object" && (!selected || selected.includes(field.name)),
  );
  if (selected && fields.length !== selected.length) throw iamAccountDenied();
  return fields.map((field) => Prisma.sql`${identifier(alias)}.${identifier(field.dbName ?? field.name)}`);
}
