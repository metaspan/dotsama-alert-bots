import { Client } from 'eris'
import axios from 'axios'
import moment from 'moment-timezone'
import fs from 'fs'
// import { ApiPromise, WsProvider } from '@polkadot/api' // get all data from the rest-api
import { Candidate } from './candidate.js'
import { DockAPI } from '@docknetwork/sdk'
const dock = new DockAPI()
const stateFile = '../state/dock-state.json'

// TODO: use this as a param .env?
const apiUrlBase = 'http://192.168.1.92:3000/polkadot/rpc/system/properties'

import { Queue, Job } from 'bullmq'

import config from './config.js'
console.log(config)


const qOpts = {
  // connection to Redis
  connection: {
    host: config.redis_host,
    port: config.redis_port,
  }
};
const jobRetention = {
  removeOnComplete: {
    age: 5 * 24 * 60 * 60, // keep up to 5 x 24 hour (in millis)
    count: 1000, // keep up to 1000 jobs
  },
  removeOnFail: {
    age: 5 * 24 * 60 * 60, // keep up to 5 x 24 hours (in millis)
  }
};
const q_dock_auto_payout = new Queue('dock_auto_payout', qOpts)

// import state from `stateFile` assert { type: 'json' };
var state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
console.debug('state', JSON.stringify(state, null, 2))
// let exampleState = { 
//   updatedAt: moment(),
//   candidates: [], // this from 'https://kusama.w3f.community/candidates'
//   subcribers: [
//     {
//       id: 'discordUserId',
//       channel: { id: 123 },
//       targets: [{ stash: '', active: true, valid: true }]
//     }
//   ]
// }
function saveState() {
  const str = JSON.stringify(state, null, 2)
  console.log('saving state', str)
  fs.writeFileSync(stateFile, str, 'utf8')
}

function slog(text) {
  console.debug(`[DEBUG] ${moment().format('YYYYMMDD HHmmss')}: ${text}`)
}

function composeStatusMessage(subscriber, candidate) {
  let message = subscriber.format === 'json'
    ? JSON.stringify({
      name: candidate.name,
      stash: candidate.stash,
      nominated: candidate.nominated,
      active: candidate.active,
      valid: candidate.valid,
      queued: candidate.queued?true:false,
      moment: moment()
    }, {}, 4)
    : `${candidate.name} \n`
      + `act.: ${candidate.active ? '🚀' : '💤'} `
      + `nom.: ${candidate.nominated ? '💰' : '🫙'} `
      + `val.: ${candidate.valid ? '👌' : '🛑'} `
      + `que.: ${candidate.queued ? '⏭️' : '⏸️'}`
  return message
}

// Create a Client instance with our bot token.
const bot = new Client(config.bot_token)

// When the bot is connected and ready, log to console.
bot.on('ready', () => {
   console.log('Connected and ready.');
  //  bot.createMessage(config.channel_id, 'Bot ready...!')
});

const helpText = 'Here is the list of commands I understand:\n'
  + '  `!help` - displays this message\n'
  + '  `!list` - list your subscriptions\n'
  + '  `!format json|pretty` - set your message format\n'
  + '  `!interval [3600]` - get|set message interval (seconds)\n'
  + '  `!sub` <validator stash> [<role>] - subscribe to alerts, role: account (default), validator\n'
  + '  `!once` <validator stash> - get data once\n'
  + '  `!unsub` <validator stash> - unsubscribe from alerts\n'
  + '  `!leave` - remove all data\n'
  + '  `!ping` - test response\n'
  // + '   - modules: valid | active | all\n'

function handleMessage (msg) {
  // const cmd = msg.content.substring(0, str.indexOf(' '))
  const parts = msg.content.split(' ')
  const cmd = parts[0] //.substr(PREFIX.length)
  // const module = parts[1]
  // const stash = parts[2]
  // console.debug(`"${cmd}" "${module}" "${stash}"`)
  let stash
  let role
  let idx
  let c, sub
  switch (cmd) {
    case '!ping':
      bot.createMessage(msg.channel.id, 'Pong!')
      break
    case '!help':
      bot.createMessage(msg.channel.id, helpText)
      break
    case '!list':
      let s = state.subscribers.find(f => f.id === msg.author.id)
      let message = s 
        // ? JSON.stringify(s.targets) 
        ? '----\n' + s.targets.map(t => {
          return `${(t.role || 'account') === 'account' ? '💰' : '🚀'}: ${t.stash}`
        }).join('\n')
        : 'None' 
      console.debug(message)
      bot.createMessage(msg.channel.id, message)
      break
    case '!leave':
      state.subscribers = state.subscribers.filter(f => f.id !== msg.author.id)
      saveState()
      bot.createMessage(msg.channel.id, `ok, bye`)
      break
    case '!interval':
      idx = state.subscribers.findIndex(s => s.id === msg.author.id)
      if (idx > -1) {
        let interval = parts[1]
        if (interval) {
          interval = Number(interval) || 1 * 60 * 60 // 1 hour
          state.subscribers[idx].interval = interval
          saveState()
          bot.createMessage(msg.channel.id, `ok, every ${interval} seconds`)
        } else {
          bot.createMessage(msg.channel.id, `every ${state.subscribers[idx].interval} seconds`)
        }  
      } else {
        bot.createMessage(msg.channel.id, `every 3600 seconds.`)
      }
      break
    case '!format':
      let format = (parts[1] === 'json') ? 'json' : 'pretty'
      idx = state.subscribers.findIndex(s => s.id === msg.author.id)
      if (idx > -1) {
        state.subscribers[idx].format = format
      } else {
        state.subscribers.push({id: msg.author.id, format: format })
      }
      saveState()
      bot.createMessage(msg.channel.id, `you will receive messages in '${format}' format`)
      break
    case '!once':
      stash = parts[1]
      if (!stash || stash === '') {
        bot.createMessage(msg.channel.id, `invalid stash '${stash||''}'\ntry !once <stash>`)
        return
      }
      c = state.candidates.find(f => f.stash === stash)
      if (c) {
        sub = state.subscribers.find(f => f.id === msg.author.id)
        if (sub === undefined) sub = {}
        let message = composeStatusMessage(sub, c)
        bot.createMessage(msg.channel.id, message)
        if (!c.valid) {
          bot.createMessage(sub.channel.id, JSON.stringify(c.validity.filter(f => !f.valid), null, 4))
        }
      } else {
        bot.createMessage(msg.channel.id, `${stash} not found. Is this a 1kv validator?`)
      }
      break
    case '!sub':
      // if (!['valid','active','all'].includes(module)) {
      //   bot.createMessage(msg.channel.id, `invalid module '${module||''}'\ntry !sub <module> <stash>`)
      //   return
      // }
      stash = parts[1]
      role = parts[2] || 'account' // 'validator'
      if (!stash || stash === '') {
        bot.createMessage(msg.channel.id, `invalid stash '${stash||''}'\ntry !sub <stash>`)
        return
      }
      idx = state.subscribers.findIndex(s => s.id === msg.author.id)
      if (idx > -1) {
        let t = state.subscribers[idx].targets.find(f => f.stash === stash)
        if (t) {
          bot.createMessage(msg.channel.id, `already subscribed to ${t.stash} ${t.role}`)
        } else {
          state.subscribers[idx].targets.push({ stash, role })
          bot.createMessage(msg.channel.id, `subscribed to ${stash}/${role}, interval ${state.subscribers[idx].interval} seconds`)
        }
      } else {
        state.subscribers.push({id: msg.author.id, interval: 3600, channel: {id: msg.channel.id}, targets: [{ stash, role }]})
        bot.createMessage(msg.channel.id, `subscribed to ${stash}/${role}, interval 3600 seconds`)
      }
      console.log('state', state)
      saveState()
      break
    case '!unsub':
      // if (!['valid','active','all'].includes(module)) {
      //   bot.createMessage(msg.channel.id, `invalid module '${module||''}'\ntry !unsub <module> <stash>`)
      //   return
      // }
      stash = parts[1]
      if (!stash || stash === '') {
        bot.createMessage(msg.channel.id, `invalid stash '${stash||''}'\ntry !unsub <module> <stash>`)
        return
      }
      idx = state.subscribers.findIndex(f => f.id === msg.author.id)
      if (idx > -1) {
        state.subscribers[idx].targets = state.subscribers[idx].targets.filter(f => f.stash !== stash)
        bot.createMessage(msg.channel.id, `unsubscribed for ${stash}`)   
        saveState()
      } else {
        slog('could not find idx')
      }
      break
    default:
      // message.channel.createMessage('Pong!')
      bot.createMessage(msg.channel.id, 'not implemented')
  }
}

// Every time a message is sent anywhere the bot is present, this event will fire
bot.on('messageCreate', async (msg) => {
  const botWasMentioned = msg.mentions.find(
    mentionedUser => mentionedUser.id === bot.user.id,
  )
  if (msg.author.id === ""+config.app_id) {
    slog('Ignore response from self...')
    return
  } else if (msg.channel.guild && !botWasMentioned) {
    slog('Ignore message to guild')
    return
  } else if (msg.channel.guild && botWasMentioned) {
    await bot.createMessage(msg.channel.id, `@${msg.author.username}, not here... please use DM`)
    return;
  } else {
    slog(msg)
  }
  if (msg.content.slice(0, 1) === '!') {
    handleMessage(msg)
  } else {
    const usage = 'try `!help` for a list of commands'
    await bot.createMessage(msg.channel.id, usage)
  }
});

bot.on('disconnect', (err) => {
  console.warn(err);
});

bot.on('error', (err) => {
  console.warn(err);
});

;(async () => {
  // const wsProvider = new WsProvider(config.validator_url)
  // const api = await ApiPromise.create({ provider: wsProvider })
  await dock.init({ address: config.rpc_url })
  const api = dock.api

  // const methods = await api.rpc.rpc.methods()
  // console.log(methods.toString())
  // note, methods != events !!

  // subscribe to all events
  api.query.system.events(async (events) => {
    slog(`Received ${events.length} events:`)

    const evtMap = new Set(events.map(record => { const { event } = record; return `${event.section}-${event.method}` }))
    console.log('events', evtMap)

    // Loop through the Vec<EventRecord>
    events.forEach(async (record) => {
      // Extract the phase, event and the event types
      const { event, phase } = record
      slog(`\tSection: ${event.section}, Method: ${event.method}, Phase=${phase.toString()}`)
      const types = event.typeDef

      if(event.section === 'session') {
        switch (event.method) {
          case 'NewSession':
            bot.createMessage(
              config.channel_id, // send to me 
              `Event: ${event.section}-${event.method} `
                + `at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
                + JSON.stringify(event.data)
            )
            break
          default:

        }
      }
  
      // api.events.staking.StakersElected.is
      if (event.section === 'staking') { // =========================== staking
        switch (event.method) {
          case 'Rewarded': // -------------------------------------------------
            const ex = {
              "index":"0x0701",
              "data":["144J3aDZgiCZ2X8aiPZ6HKuds3Zn6HNkkSQVNkWtHAgxYae7",3084992450]
            }
            const stash = event.data[0].toString()
            const amount = event.data[1]
            state.subscribers.forEach(sub => {
              console.log(`Checking reward for ${stash} against targets`, sub.targets.map(t => t.stash))
              // const c = state.candidates.find(f => f.stash === stash)
              const tidx = sub.targets.findIndex(t => t.stash === stash)
              // console.debug('stash', stash)
              // console.debug('tidx', tidx)
              // console.debug('targets', sub.targets)
              if (tidx > -1) {
                // const t = sub.targets[stash]
                try {
                  const [] = event.data
                  bot.createMessage(
                    sub.channel.id, // back to subscriber
                    'staking.Reward:'
                    + ` at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
                    // + `\t (phase=${phase.toString()})`
                    + `\n${stash}: ${amount/1000000} DOCK`
                  )
                } catch (err) {
                  bot.createMessage(
                    config.channel_id, // send to me
                    'staking.Reward: ERROR: ' + err.toString()
                  )
                }
              } else {
                slog('staking.Reward: skipping ' + stash)
              }
            })
            break;
          //case 'stakersElected': // ===========================================
          //case 'StakingElection':
          //  // Show what we are busy with
          //  slog(`\t${event.section}:${event.method}:: (phase=${phase.toString()})`)
          //  bot.createMessage(
          //    config.channel_id, // send to me 
          //    'Seems we have Event:'
          //      + `at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
          //      + `\t${event.section}:${event.method}:: (phase=${phase.toString()})`
          //  )
          //  // console.log(`\t\t${event.meta.documentation?.toString()}`)
          //  // Loop through each of the parameters, displaying the type and data
          //  event.data.forEach((data, index) => {
          //    slog(`\t\t\t${types[index].type}: ${data.toString()}`);
          //  })
          //  break;
          case 'slashReported': // ============================================
          case 'Withdrawn':
          default:
            break;
        }
      }

      //// staking-miner submits electionProviderMultiPhase.submit
      //if (event.section === 'electionProviderMultiPhase') {
      //  // && event.method.toUpperCase() === 'SUBMIT') {
      //  // console.log(event.section, event.method, phase.toString())
      //  console.log(event.toString(), phase.toString())
      //  switch (event.method) {
      //    case 'ElectionFinalized':  // ElectionFinalized(PalletElectionProviderMultiPhaseElectionCompute, SpNposElectionsElectionScore)
      //      // {"index":"0x2500","data":["Signed",false]}
      //      const jobs = await Promise.all([
      //        q_dock_auto_payout.add('dock_auto_payout', {
      //          wsProvider: 'wss://mainnet-node.dock.io',
      //          denom: 'DOCK',
      //          decimalPlaces: 6,
      //          validators: [
      //            '3D6KKyNq3rocxZUjV9ZKrM3gWP6dXKxmV9umCepjbsGBE5di',
      //            '3E6NNUnsrTPSRQ59bSBAPf2UVwWawyy4VsYWnHRvf1Z4F2SA'
      //          ],
      //          accountJSON: './functions/keystores/3GgB5XbVKerzR8MXjUDCvWJ3gwiADW8e77gVeC93LEhcU7w7.json',
      //          password: 'vsY8wdZTcLRPsLgBz@',
      //          log: true,
      //        }, { repeat: false, ...jobRetention }),
      //        // q_dock_auto_payout.add('dock_auto_payout', {
      //        //   wsProvider: 'wss://mainnet-node.dock.io',
      //        //   denom: 'DOCK',
      //        //   decimalPlaces: 6,
      //        //   validator: '3E6NNUnsrTPSRQ59bSBAPf2UVwWawyy4VsYWnHRvf1Z4F2SA',
      //        //   accountJSON: './functions/keystores/3GgB5XbVKerzR8MXjUDCvWJ3gwiADW8e77gVeC93LEhcU7w7.json',
      //        //   password: 'vsY8wdZTcLRPsLgBz@',
      //        //   log: true,
      //        // }, { repeat: false, ...jobRetention })
      //      ])            
      //      bot.createMessage(
      //        config.channel_id,
      //        `${event.section}.${event.method}: at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
      //          + `\n(phase=${phase.toString()})`
      //          + `\ncreated ${jobs.length} jobs`
      //      )
      //      break
      //      case 'SolutionStored':     // SolutionStored(PalletElectionProviderMultiPhaseElectionCompute, bool)
      //      case 'ElectionFailed':     // ElectionFailed()
      //      // {"index":"0x2501","data":["Signed",{"minimalStake":"0x000000000000000000163325867f3357","sumStake":"0x000000000000000061e9c3af92229491","sumStakeSquared":"0x0009d95026bf45cf04a5bc976b46bc7b"}]}
      //    case 'Slashed':            // Slashed(AccountId32, u128)
      //    case 'Rewarded':           // Rewarded(AccountId32, u128)
      //      // {"index":"0x2503","data":["H2LjzjkgpyUiNeazaBxVNjTujzUEgCJKGJ5VykHsj3JD5rx",100000000000]}
      //    case 'SignedPhaseStarted': // SignedPhaseStarted(u32)
      //      // {"index":"0x2505","data":[2301]}
      //    case 'UnsignedPhaseStarted': // UnsignedPhaseStarted(u32)
      //      // {"index":"0x2506","data":[2301]}
      //    default:
      //      bot.createMessage(
      //        config.channel_id, // send to me
      //        `${event.section}.${event.method}: at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
      //          + `\n(phase=${phase.toString()})`
      //          + '\n' + JSON.stringify(event)
      //      )
      //  }
      //} // end of electionProviderMultiPhase.submit

    })

  }) // End of Event Loop

  // every 10 mins: check if s.target is a validator...
  setInterval(async () => {
    const result = await axios.get(`http://192.168.1.92:3000/dock/query/staking/validators`)
    const validators = result.data.validators || []
    // for each subscriber
    state.subscribers.forEach(async (sub) => {
      // filter targets for validators only
      sub.targets.filter(f => f.role === 'validator').forEach(async (t) => {
        const idx = validators.findIndex(f => f.stash === t.stash)
        if(idx === -1) {
          // not a validator, send a warning!
          const message = `⚠️ Stash ${t.stash} is not a validator`
          await bot.createMessage(sub.channel.id, message)
        // } else {
        //   const message = `🌟 Stash ${t.stash} is a validator`
        //   await bot.createMessage(sub.channel.id, message)
        }
      })
    })
  }, 10 * 60 * 1000) // every 10 mins

  // main interval loop...
  // setInterval(async () => {
  //   slog('=== Interval starts...')
  //   slog('Checking subscribers: '+ state.subscribers.length)
  //   let updated = false
  //   state.subscribers.forEach((sub, idx) => {
  //     let age = moment().diff(moment(sub.updatedAt), 'seconds')
  //     slog(`id: ${sub.id}, age: ${age}, updateAt ${sub.updatedAt}`)
  //     if (sub.updatedAt === '' || sub.updatedAt === undefined || age > sub.interval) {
  //       sub.targets?.filter(f => f.role === 'validator').forEach(t => {
  //         const c = new Candidate(state.candidates.find(c => c.stash === t.stash))
  //         if (c) {
  //           // // const wasValid = c.valid
  //           const val_check = c.validity.filter(f => !f.valid)
  //           // if (!c.valid) {
  //           //   // check validity
  //           //   bot.createMessage(
  //           //   '983358544650858507',
  //           //   'INVALID: '
  //           //   + '- ' + moment().format('YYYY.MM.DD HH:mm:ss') + ': \n'
  //           //   + '- ' + c.stash + ' \n'
  //           //   + JSON.stringify(c.valid) + ' \n'
  //           //   + JSON.stringify(c.validity) + ' \n'
  //           //   + JSON.stringify(c.invalidityReasons)
  //           //   )
  //           //   if (val_check.length == 0) c.valid = true
  //           // }
  //           c.valid = val_check.length === 0
  //           let message = composeStatusMessage(sub, c)
  //           bot.createMessage(sub.channel.id, message)
  //           if (!c.valid) bot.createMessage(sub.channel.id, JSON.stringify(val_check, null, 4))
  //         }
  //       })
  //       state.subscribers[idx].updatedAt = moment()
  //       updated = true
  //     }
  //   })
  //   if (updated) saveState()
  //   slog('=== Interval ends...')
  // }, config.update_interval) // setInterval
  
  bot.connect()

})()
