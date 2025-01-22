import { extractSignature } from '../../utils/eth'
export const normalizeIdentifiers = (enrollmentIdentifier, fvSigner = null) => {
  // account for eip 6492 wrapped signature
  const extractedSig = extractSignature(enrollmentIdentifier)
  return { v2Identifier: extractedSig.slice(0, 42), v1Identifier: fvSigner ? fvSigner.replace('0x', '') : null }
}
