import * as ethUtil from 'ethereumjs-util'

export const recoverPublickey = (signature, msg, nonce) => {
  const sig = ethUtil.fromRpcSig(signature)

  const messageHash = ethUtil.keccak(
    `\u0019Ethereum Signed Message:\n${(msg.length + nonce.length).toString()}${msg}${nonce}`
  )

  const publicKey = ethUtil.ecrecover(messageHash, sig.v, sig.r, sig.s)
  return ethUtil.bufferToHex(ethUtil.pubToAddress(publicKey))
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
