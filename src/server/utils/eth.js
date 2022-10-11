import Accounts from 'web3-eth-accounts'
import { messageContains } from './exception'

const accounts = new Accounts()

export const recoverPublickey = (signature, msg, nonce) => {
  const publicKey = accounts.recover(String(msg) + String(nonce), signature).toLowerCase()

  return publicKey
}

export const verifySignature = async (message, signature) => {
  try {
    // recoverPublickey() also could throw so we're wrapping its call to try block
    const recovered = recoverPublickey(signature, message, '')

    if (recovered.substr(2) !== message.toLowerCase()) {
      throw new Error("Public key doesn't matches")
    }
  } catch (exception) {
    exception.message = `SigUtil unable to recover the message signer`
    throw exception
  }
}

/**
 * Return boolean
 * @param e Error
 * @returns boolean
 */
export const isNonceError = e => messageContains(e, 'nonce')

export const isFundsError = e => messageContains(e, 'funds')
