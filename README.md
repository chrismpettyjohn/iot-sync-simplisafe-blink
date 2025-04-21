# iot-sync-simplisafe-blink
Watches Gmail for Simplisafe notifications and arms/disarms Blink appropiately

## References
[Blink API Protocol](https://github.com/MattTW/BlinkMonitorProtocol)

## Requirements
* [NodeJS](https://nodejs.org/en/download)
* [Bun](https://bun.sh/docs/installation)
* Simplisafe set to send email notifications

## Execution
1. cp .env.example .env
2. Create an [app password](https://myaccount.google.com/apppasswords) on Gmail 
3. Update `.env` with your credentials
4. `bun install`
5. `bun start`
6. You will be asked for your Blink 2FA.  Type it in
7. Upon successful login, update `.env` and set `BLINK_VALIDATED=true`

## How it works
The script will stay running once logged in and monitor your inbox for notifications from Simplisafe.  It will notify you of any success or failures that may occur.