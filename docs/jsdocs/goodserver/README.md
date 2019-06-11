# @gooddollar/goodserver v0.1.0

GoodDollar Server

- [Login](#login)
	- [Request user token](#request-user-token)
	
- [Send](#send)
	- [Send link email](#send-link-email)
	- [Send link sms](#send-link-sms)
	- [Send recovery instructions email](#send-recovery-instructions-email)
	
- [Storage](#storage)
	- [Add user account](#add-user-account)
	- [Delete user account](#delete-user-account)
	
- [Verification](#verification)
	- [Verify email code](#verify-email-code)
	- [Verify users face](#verify-users-face)
	- [Verify mobile data code](#verify-mobile-data-code)
	- [Send verification email endpoint](#send-verification-email-endpoint)
	- [Sends OTP](#sends-otp)
	- [Tops Users Wallet if needed](#tops-users-wallet-if-needed)
	- [Whitelist user](#whitelist-user)
	


# Login

## Request user token



	POST /auth/eth


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| signature			| String			|  							|
| gdSignature			| String			|  							|
| profilePublickey			| String			|  							|
| profileSignature			| String			|  							|
| nonce			| String			|  							|
| method			| String			|  							|

# Send

## Send link email



	POST /send/linkemail


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| to			| String			|  							|
| sendLink			| String			|  							|

## Send link sms



	POST /send/linksms


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| to			| String			|  							|
| sendLink			| String			|  							|

## Send recovery instructions email



	POST /send/recoveryinstructions


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| mnemonic			| String			|  							|

# Storage

## Add user account



	POST /user/add


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| user			| Object			|  							|

## Delete user account



	POST /user/delete


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| zoomId			| String			|  							|

# Verification

## Verify email code



	POST /verify/email


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| verificationData			| Object			|  							|
| verificationData.code			| String			|  							|

## Verify users face



	POST /verify/facerecognition


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| enrollmentIdentifier			| String			|  							|
| sessionId			| String			|  							|

## Verify mobile data code



	POST /verify/mobile


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| verificationData			| Object			|  							|

## Send verification email endpoint



	POST /verify/email


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| user			| UserRecord			|  							|

## Sends OTP



	POST /verify/sendotp


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| user			| UserRecord			|  							|

## Tops Users Wallet if needed



	POST /verify/topwallet


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| user			| LoggedUser			|  							|

## Whitelist user



	POST /verify/user


### Parameters

| Name    | Type      | Description                          |
|---------|-----------|--------------------------------------|
| verificationData			| Object			|  							|


