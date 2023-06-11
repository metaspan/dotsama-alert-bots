import 'dotenv/config'

const config = {
  rpc_url: process.env.RPC_URL,
  redis_host: process.env.REDIS_HOST,
  redis_port: process.env.REDIS_PORT,
  bot_token: process.env.BOT_TOKEN,
  app_id: process.env.APP_ID,
  public_key: process.env.PUBLIC_KEY,
  candidates_url: process.env.CANDIDATES_URL,
  nominators_url: process.env.NOMINATORS_URL,
  update_interval: process.env.UPDATE_INTERVAL,
  channel_id: process.env.CHANNEL_ID,
}

export default config
