import { toChecksumAddress } from 'web3-utils'

import { recoverPublickey } from '../../utils/eth'
import { strcasecmp } from '../../utils/string'
import { FV_IDENTIFIER_MSG2 } from '../../login/login-middleware'

export const normalizeIdentifiers = (enrollmentIdentifier, fvSigner = null) => ({
  v2Identifier: enrollmentIdentifier.slice(0, 42),
  v1Identifier: fvSigner ? fvSigner.replace('0x', '') : null
})

export const verifyIdentifier = (enrollmentIdentifier, gdAddress) => {
  // check v2, v2 identifier is expected to be the whole signature
  if (enrollmentIdentifier.length < 42) {
    return
  }

  const signer = recoverPublickey(
    enrollmentIdentifier,
    FV_IDENTIFIER_MSG2({ account: toChecksumAddress(gdAddress) }),
    ''
  )

  if (strcasecmp(signer, gdAddress)) {
    // returns 0 if equals
    throw new Error(`Identifier signer doesn't match user ${signer} != ${gdAddress}`)
  }
}
