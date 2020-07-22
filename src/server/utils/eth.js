import { Accounts } from 'web3-eth-accounts'
import { get } from 'lodash'
const accounts = new Accounts()
export const recoverPublickey = (signature, msg, nonce) => {
  const publicKey = accounts.recover(String(msg) + String(nonce), signature).toLowerCase()
  return publicKey
}

/**
 * Return boolean
 * @param e Error
 * @returns boolean
 */
export const isNonceError = e => {
  const message = String(get(e, 'message', ''))
  return message.toLowerCase().indexOf('nonce') >= 0
}
export const isFundsError = e => {
  const message = String(get(e, 'message', ''))
  return message.toLowerCase().indexOf('funds') >= 0
}
