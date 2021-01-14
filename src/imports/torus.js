import '@ungap/global-this'
import fetch from 'node-fetch'
import { defaults } from 'lodash'

// eslint-disable-next-line no-undef
defaults(globalThis, { fetch })

export { default as FetchNodeDetails } from '@toruslabs/fetch-node-details/dist/fetchNodeDetails-node.js'
export { default as TorusUtils } from '@toruslabs/torus.js/dist/torusUtils-node.js'
