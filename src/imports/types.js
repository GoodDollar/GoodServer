// @flow
export type UserRecord = {
  pubkey: string,
  fullName?: string,
  mobile?: string,
  email?: string,
  jwt?: string,
  smsValidated?: boolean,
  isEmailConfirmed?: boolean,
  otp?: { code: number, expirationDate: number }
}

export type JWTRecord = {
  method: 'eth',
  loggedInAs: string,
  gdAddress: string,
  profilePublickey: string
}

export type LoggedUser = JWTRecord & UserRecord

export interface StorageAPI {
  getUser(pubkey: string): Promise<UserRecord>;
  getUserField(pubkey: string, field: string): Promise<any>;
  addUser(user: UserRecord): Promise<boolean>;
  updateUser(user: UserRecord): Promise<boolean>;
  deleteUser(user: UserRecord): Promise<boolean>;
  sanitizeUser(user: UserRecord): UserRecord;
}

export interface VerificationAPI {
  verifyUser(user: UserRecord, verificationData: any): Promise<boolean | Error>;
  verifyMobile(user: UserRecord, verificationData: { otp: string }): Promise<boolean | Error>;
}
