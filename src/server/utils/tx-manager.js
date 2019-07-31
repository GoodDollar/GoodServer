import WalletNonce from '../models/wallet-nonce'

class TransactionRun {
  
  constructor() {
    
    this.model = WalletNonce;
    this.queue = [];
  
    const filter = [{
      $match: {
        $and: [
          { "updateDescription.updatedFields.isLock": {$eq:false} },
          { operationType: "update" }]
      }
    }];
  
    const options = { fullDocument: 'updateLookup' };
    
    // listen to the collection
    this.model.watch(filter, options).on('change', data => {
      this.run()
    });
    
  }
  
  /**
   * Get new nonce after increment
   * @param address
   * @param netNonce
   * @returns {Promise<*>}
   */
  async getWalletNonce(address, netNonce) {
    
    try {
 
      let wallet =  await this.model.findOneAndUpdate(
        {address, isLock: false},
        {isLock: true},
        {returnNewDocument: true}
      );
     
      return wallet;
      
    } catch (e) {
      console.log(e)
      return false
    }
  }
  
  /**
   * Create if not exist nonce to db
   * @param address
   * @param netNonce
   * @returns {Promise<void>}
   */
  async createIfNotExist(address, netNonce) {
    
    try {
      
      let wallet = await this.model.findOne(
        {address}
      );
      
      if (!wallet) {
        await this.model.create({
          address,
          nonce: netNonce
        })
      }
      
    } catch (e) {
      
      console.log(e)
      
    }
  }

  /**
   * unSet lock for queue
   * @param address
   * @returns {*}
   */
  unlock(address, nextNonce) {
    return this.model.findOneAndUpdate(
      {address, isLock: true},
      {
        isLock: false,
        nonce: nextNonce
      },
      {returnNewDocument: true}
    )
  }
  
  /**
   * Add new tr to queue
   * @param address
   * @param netNonce
   * @param cb
   * @param done
   * @param fail
   * @returns {Promise<void>}
   */
  async addToQueue(address, netNonce, cb, done, fail) {

    await this.createIfNotExist(address, netNonce);
    
    this.queue.push({cb, done, address, fail})
  
    this.run();
  }
  
  /**
   * Run the first transaction from the queue
   * @returns {Promise<void>}
   */
  async run() {
    
    try {
    
      if (this.queue.length > 0) {
        
        const nextTr = this.queue[0];
        
        const walletNonce = await this.getWalletNonce(nextTr.address);

        if (walletNonce) {
        
          this.queue.shift();
          
          let tx = null;
          
          try {
            tx = await nextTr.cb(walletNonce.nonce);
          } catch (e) {
            console.log(e);
            await this.unlock(nextTr.address, walletNonce.nonce);
            nextTr.fail(e)
          }
          
          await this.unlock(nextTr.address, walletNonce.nonce + 1);
          nextTr.done(tx)
        }
        
      }
    } catch (e) {
      console.log(e)
    }
    
  }
}


export default new TransactionRun()
