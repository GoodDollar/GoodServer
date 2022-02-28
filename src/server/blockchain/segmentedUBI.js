//@flow
import { PhoneNumberUtil } from 'google-libphonenumber'
import AdminWallet from './AdminWallet'
import logger from '../../imports/logger'

const log = logger.child({ from: 'AdminWalletV2' })

const phoneUtil = PhoneNumberUtil.getInstance()

export const SegmentedUBI = {
  async getSegmentedPoolsInfo(address: string): Promise<Array<{}>> {
    const pools = await AdminWallet.SegmentedIdentityContract.methods.memberToPools(address).call()
    const poolInfos = await Promise.all(pools.map(p => AdminWallet.SegmentedIdentityContract.methods.pools(p).call()))
    return poolInfos
  },

  async addToSegmentedPool(address: string, countryCode: string, hashedMobile: string): Promise {
    try {
      const description = `Country UBI ${countryCode}`
      //check if pool exists
      const create2Addr = getCreate2(AdminWallet.proxyContract._address, description)
      const pool = await AdminWallet.SegmentedIdentityContract.methods.pools(create2Addr).call()
      const exists = pool.pool === create2Addr

      //create pool if not exists
      if (!exists) {
        let encodedCall = AdminWallet.web3.eth.abi.encodeFunctionCall(
          {
            name: 'setupPool',
            type: 'function',
            inputs: [
              {
                type: 'address',
                name: 'inclusionAdmin'
              },
              {
                type: 'string',
                name: 'description'
              },
              {
                type: 'bool',
                name: 'allowFoundationAdmin'
              },
              {
                type: 'address',
                name: 'uniqueness'
              },
              {
                type: 'bytes32',
                name: 'merkleDrop'
              }
            ]
          },
          [AdminWallet.proxyContract._address, description, true, AdminWallet.identityContract._address, '']
        )
        const transaction = await AdminWallet.proxyContract.methods.genericCall(
          AdminWallet.SegmentedIdentityContract._address,
          encodedCall,
          0
        )

        const txPromise = AdminWallet.sendTransaction(transaction, {}, { gas: 200000 }, true, logger)
        let res = await txPromise
        logger.debug('addToSegmentedPool setupPool result:', {
          args: [AdminWallet.proxyContract._address, description, true, AdminWallet.identityContract._address, ''],
          res
        })
      }
      let encodedCall = AdminWallet.web3.eth.abi.encodeFunctionCall(
        {
          name: 'addMember',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: 'pool'
            },
            {
              type: 'address',
              name: 'member'
            },
            {
              type: 'bytes32',
              name: 'identifier'
            }
          ]
        },
        [create2Addr, address, hashedMobile]
      )
      const transaction = await AdminWallet.proxyContract.methods.genericCall(
        AdminWallet.SegmentedIdentityContract._address,
        encodedCall,
        0
      )

      const txPromise = AdminWallet.sendTransaction(transaction, {}, { gas: 200000 }, true, logger)
      let res = await txPromise
      logger.debug('addToSegmentedPool addMember result:', {
        args: [create2Addr, address, hashedMobile],
        res
      })
    } catch (e) {
      logger.error('Error addToSegmentedPool', e.message, e, { address, countryCode, hashedMobile })
      throw e
    }
  },

  async removeFromSegmentedPool(pool: string, address: string): Promise {
    try {
      let encodedCall = AdminWallet.web3.eth.abi.encodeFunctionCall(
        {
          name: 'removeMember',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: 'pool'
            },
            {
              type: 'address',
              name: 'member'
            }
          ]
        },
        [pool, address]
      )
      const transaction = await AdminWallet.proxyContract.methods.genericCall(
        AdminWallet.SegmentedIdentityContract._address,
        encodedCall,
        0
      )

      const txPromise = AdminWallet.sendTransaction(transaction, {}, { gas: 200000 }, true, logger)
      let res = await txPromise
      logger.debug('removeFromSegmentedUBI result:', { pool, address, res })
      return res
    } catch (e) {
      logger.error('Error removeFromSegmentedUBI', e.message, e, { pool, address })
      throw e
    }
  },

  async add(walletAddress, mobile, hashedMobile, oldMobileHash) {
    try {
      mobile = mobile.startsWith('+') ? mobile : `+${mobile}`
      const number = phoneUtil.parse(mobile)
      const countryCode = number.getCountryCode()
      //get wallet pools
      const pools = await this.getSegmentedPoolsInfo(walletAddress)
      //check if already member of some other country pool
      const otherCountryPools = pools.find(
        p =>
          p.owner === AdminWallet.proxyContract.address &&
          p.description.includes('Country UBI') &&
          !p.description.includes(`Country UBI ${countryCode}`)
      )

      //if already member of other country pools, remove and switch
      await Promise.all(otherCountryPools.map(pool => this.removeFromSegmentedPool(pool, walletAddress)))

      await this.addToSegmentedPool(walletAddress, countryCode, hashedMobile)
    } catch (e) {
      log.error('failed adding wallet to segmented ubi', e.message, e, {
        walletAddress,
        mobile,
        hashedMobile,
        oldMobileHash
      })
    }
  }
}
