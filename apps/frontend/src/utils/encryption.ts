import CryptoJS from 'crypto-js'

const md5 = (data: string): string => {
  return CryptoJS.MD5(data).toString()
}

export { md5 }
