import { CustomCode } from '@/constant/custom-code'
import { HttpStatusCode } from 'axios'

export const getHttpStatusText = (
  code: (typeof HttpStatusCode)[keyof typeof HttpStatusCode],
): keyof typeof HttpStatusCode => {
  return HttpStatusCode[code] as keyof typeof HttpStatusCode
}

export const getCustomCodeText = (
  code: (typeof CustomCode)[keyof typeof CustomCode],
): keyof typeof CustomCode => {
  return CustomCode[code] as keyof typeof CustomCode
}
