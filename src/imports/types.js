// @flow
export type UserRecord = {
    pubkey:string,
    fullName?:string,
    mobile?:string,
    email?:string,
    jwt?:string
}

export interface StorageAPI {
    addUser(user: UserRecord): Promise<boolean>,
    updateUser(user: UserRecord): Promise<boolean>,
    deleteUser(user: UserRecord): Promise<boolean>
}

export interface VerificationAPI {
    verifyUser(user: UserRecord, verificationData:any):boolean,
}
