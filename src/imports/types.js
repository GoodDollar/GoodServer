// @flow
export type UserRecord = {
    pubkey:string,
    fullName?:string,
    mobile?:string,
    email?:string,
    jwt?:string
}

export interface StorageAPI {
    addUser(user: UserRecord):boolean,
    updateUser(user: UserRecord):boolean,
    deleteUser(user: UserRecord):boolean
}

export interface VerificationAPI {
    verifyUser(user: UserRecord, verificationData:any):boolean,
}