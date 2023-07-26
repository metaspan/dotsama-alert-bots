import 'dotenv/config'

const config = {
  redis_host: process.env.REDIS_HOST,
  redis_port: process.env.REDIS_PORT,
  rpc_url: process.env.RPC_URL,
  bot_token: process.env.BOT_TOKEN,
  app_id: process.env.APP_ID,
  public_key: process.env.PUBLIC_KEY,
  channel_id: process.env.CHANNEL_ID,
  update_interval: process.env.UPDATE_INTERVAL,
}

export default config
