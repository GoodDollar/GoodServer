import Accounts from 'web3-eth-accounts'
import * as ethers from 'ethers'
import { toChecksumAddress } from 'web3-utils'
import { verifyMessage } from '@ambire/signature-validator'
import { messageContains } from './exception'
import { mustache } from '../utils/string'

export const FV_IDENTIFIER_MSG2 =
  mustache(`Sign this message to request verifying your account {account} and to create your own secret unique identifier for your anonymized record.
You can use this identifier in the future to delete this anonymized record.
WARNING: do not sign this message unless you trust the website/application requesting this signature.`)

const accounts = new Accounts()

const is6492Sig = signature => {
  return signature.endsWith('6492649264926492649264926492649264926492649264926492649264926492')
}

export const extractSignature = signature => {
  if (is6492Sig(signature)) {
    const [, , erc1271Signature] = ethers.utils.defaultAbiCoder.decode(['address', 'bytes', 'bytes'], signature)
    return erc1271Signature
  }
  return signature
}

export const recoverPublickey = (signature, msg, nonce = '') => {
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

    return recovered
  } catch (exception) {
    exception.message = `SigUtil unable to recover the message signer`
    throw exception
  }
}

export const verifyIdentifier = async (fvsig, gdAddress, chainId = 42220) => {
  // check v2, v2 identifier is expected to be the whole signature
  if (fvsig.length < 42) {
    return
  }

  const fuseProvider = new ethers.providers.JsonRpcProvider('https://rpc.fuse.io')
  const celoProvider = new ethers.providers.JsonRpcProvider('https://forno.celo.org')
  const xdcProvider = new ethers.providers.JsonRpcProvider('https://rpc.xdc.network')

  let provider = celoProvider
  switch (String(chainId)) {
    case '42220':
      provider = celoProvider
      break
    case '122':
      provider = fuseProvider
      break
    case '50':
      provider = xdcProvider
      break
    default:
      break
    // log.warn('verifyIdentifier unsupported chainId defaulting to Celo', chainId)
  }
  const verifyResult = await verifyMessage({
    provider,
    signer: toChecksumAddress(gdAddress),
    signature: fvsig,
    message: FV_IDENTIFIER_MSG2({ account: toChecksumAddress(gdAddress) })
  })

  if (!verifyResult) {
    // returns 0 if equals
    throw new Error(`FV identifier signature verification faild`)
  }
  return verifyResult
}

/**
 * Return boolean
 * @param e Error
 * @returns boolean
 */
export const isNonceError = e => messageContains(e, 'nonce')

export const isFundsError = e => messageContains(e, 'funds')
