import { Accounts } from 'web3-eth-accounts'

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
  const message = (e && e.message && String(e.message)) || ''
  return !!(
    ~message.indexOf('Transaction nonce is too low') ||
    ~message.indexOf("the tx doesn't have the correct nonce") ||
    ~message.indexOf('transaction with same nonce in the queue')
  )
}
