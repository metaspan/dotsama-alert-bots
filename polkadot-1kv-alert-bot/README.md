# polkadot-1kv-alert-bot

Use this bot to notify you of valid / active status on Polkadot 1KV

## Getting started

```
git clone https://github.com/metaspan/polkadot-1kv-alert-bot
cd polkadot-1kv-alert-bot
npm install
```

## Dependencies

- Register an app with discord
- update the config.js with your `app_id`

## Forever / pm2

`pm2 start bot.js`

## Usage

```
Here is the list of commands I understand:
  !help - displays this message
  !list - list your subscriptions
  !format json|pretty - set your message format
  !interval [3600] - get|set message interval (seconds)
  !once <validator stash> - get data once
  !sub <validator stash> - subscribe to alerts
  !unsub <validator stash> - unsubscribe from alerts
  !leave - remove all data
```

## References

- https://polkadot.network/blog/join-kusamas-thousand-validators-programme/
- 1KV Status from https://polkadot.w3f.community/candidates
- 1KV Nominators from https://polkadot.w3f.community/nominators

## Example messages

<img width="441" alt="image" src="https://user-images.githubusercontent.com/1845970/179616600-8afb0e70-ac39-4aa3-93c4-456b428a9128.png">
