// @flow
import { fromPairs } from 'lodash'

import { UserRecord } from '../../imports/types'

const fieldsMap = {
  firstName: 'first_name',
  lastName: 'last_name',
  fullName: 'fullname',
  regMethod: 'regmethod',
  torusProvider: 'torusprovider'
}

export type Contact = {
  identifier: string,
  first_name: string,
  last_name: string,
  mobile?: string,
  email: string,
  regmethod: string,
  torusprovider: string,
  term_utm: string,
  content_utm: string,
  source_utm: string,
  medium_utm: string,
  campaign_utm: string,
  whitelisted?: string,
  version_joined?: string,
  signup_completed?: string
}

export interface CrmApi {
  createContact(contact: UserRecord, logger): string;
  updateContact(identifier: string, fields: { [key: string]: stirng }, logger): string;
  deleteContactFromDNC(email: string, logger): any;
  addContactToDNC(email: string, logger): any;
  getContactByEmail(email: string, logger): any;
  getContactById(id: string, logger): any;
  deleteContact(id: string, logger): any;
  setWhitelisted(id: string, logger): any;
}

export const userRecordToContact = (user: UserRecord): Contact =>
  fromPairs(Object.entries(user).map(([field, value]) => [fieldsMap[field] || field.toLowerCase(), value]))
