import { Client } from 'eris'
import axios from 'axios'
import moment from 'moment-timezone'
import fs from 'fs'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Candidate } from './candidate.js'

import config from './config.js'
console.log(config)

import { Queue, Job } from 'bullmq'
const qOpts = {
  // connection to Redis
  connection: {
    host: config.redis_host, // "192.168.1.38",
    port: config.redis_port, // 6379
  }
};
const jobRetention = {
  removeOnComplete: {
    age: 5 * 24 * 60 * 60, // keep up to 5 * 24 hour (in millis)
    count: 1000, // keep up to 1000 jobs
  },
  removeOnFail: {
    age: 5 * 24 * 60 * 60, // keep up to 5 * 24 hours (in millis)
  }
};
const q_w3f_exposures_update  = new Queue('w3f_exposures_update', qOpts)
const q_w3f_nominators_update = new Queue('w3f_nominators_update', qOpts)
const q_w3f_nominations_update = new Queue('w3f_nominations_update', qOpts)
const q_w3f_validators_update = new Queue('w3f_validators_update', qOpts)
const q_check_pool = new Queue('check_pool', qOpts)

import state from '../state/polkadot-state.json' assert { type: 'json' }
// let exampleState = { 
//     updatedAt: moment(),
//     candidates: [], // this from 'https://kusama.w3f.community/candidates'
//     subcribers: [
//         {
//             id: 'discordUserId',
//             channel: { id: 123 },
//             targets: [{ stash: '', active: true, valid: true }]
//         }
//     ]
// }
function saveState() {
    fs.writeFileSync('state.json', JSON.stringify(state, null, 4), 'utf8')
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
            + `active: ${candidate.active ? '🚀' : '💤'} `
            + `nominated: ${candidate.nominated ? '💰' : '🫙'} `
            + `valid: ${candidate.valid ? '👌' : '🛑'} `
            + `queued: ${candidate.queued ? '⏭️' : '⏸️'}`
    return message
}

// Create a Client instance with our bot token.
const bot = new Client(config.bot_token)

// When the bot is connected and ready, log to console.
bot.on('ready', () => {
   console.log('Connected and ready.');
});

const helpText = 'Here is the list of commands I understand:\n'
    + '  `!help` - displays this message\n'
    + '  `!list` - list your subscriptions\n'
    + '  `!format json|pretty` - set your message format\n'
    + '  `!interval [3600]` - get|set message interval (seconds)\n'
    + '  `!sub` <validator stash> - subscribe to alerts\n'
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
            let message = s ? JSON.stringify(s.targets) : 'None' 
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
            //     bot.createMessage(msg.channel.id, `invalid module '${module||''}'\ntry !sub <module> <stash>`)
            //     return
            // }
            stash = parts[1]
            if (!stash || stash === '') {
                bot.createMessage(msg.channel.id, `invalid stash '${stash||''}'\ntry !sub <stash>`)
                return
            }
            idx = state.subscribers.findIndex(s => s.id === msg.author.id)
            if (idx > -1) {
                let t = state.subscribers[idx].targets.find(f => f.stash === stash)
                if (t) {
                    bot.createMessage(msg.channel.id, `already subscribed to ${stash}`)
                } else {
                    state.subscribers[idx].targets.push({stash: stash})
                    bot.createMessage(msg.channel.id, `subscribed to ${stash}, interval ${state.subscribers[idx].interval} seconds`)
                }
            } else {
                state.subscribers.push({id: msg.author.id, interval: 3600, channel: {id: msg.channel.id}, targets: [{stash: stash}]})
                bot.createMessage(msg.channel.id, `subscribed to ${stash}, interval 3600 seconds`)
            }
            saveState()
            break
        case '!unsub':
            // if (!['valid','active','all'].includes(module)) {
            //     bot.createMessage(msg.channel.id, `invalid module '${module||''}'\ntry !unsub <module> <stash>`)
            //     return
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

(async () => {
  const wsProvider = new WsProvider(config.rpc_url)
  const api = await ApiPromise.create({ provider: wsProvider, noInitWarn: true, throwOnConnect: true })

  api.query.system.events(async (events) => {
    slog(`Received ${events.length} events:`)
  
    // Loop through the Vec<EventRecord>
    events.forEach(async (record) => {
      // Extract the phase, event and the event types
      const { event, phase } = record
      const types = event.typeDef

      // SESSION
      if(event.section === 'session') {
        switch (event.method) {
          case 'NewSession':
            bot.createMessage(
              config.channel_id, // send to me 
              `Event: ${event.section}-${event.method} `
                + `at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
                + JSON.stringify(event.data)
            )
            const jobs = await Promise.all([
              q_w3f_exposures_update.add('w3f_exposures_polkadot2', { CHAIN: 'polkadot', trigger: 'session.NewSession' }, { repeat: false, ...jobRetention }),
              q_w3f_nominators_update.add('w3f_nominators_polkadot2', { CHAIN: 'polkadot', trigger: 'session.NewSession' }, { repeat: false, ...jobRetention }),
              q_w3f_nominations_update.add('w3f_nominations_polkadot2', { CHAIN: 'polkadot', trigger: 'session.NewSession' }, { repeat: false, ...jobRetention }),
              q_w3f_validators_update.add('w3f_validators_polkadot2', { CHAIN: 'polkadot', trigger: 'session.NewSession' }, { repeat: false, ...jobRetention }),
              q_check_pool.add('check_pool:polkadot', { chainId: 'polkadot', poolAddress: '13UVJyLnbVp8c4FQeiGDrYotodEcyAzE8tipNEMc61UBJAH4' }, { repeat: false, ...jobRetention }),
            ])
            bot.createMessage(
              config.channel_id, // send to me 
              `Created new jobs `
                + `at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
                + ` raised ${jobs.length} jobs`
            )
            break
          default:

        }
      }

      // STAKING
      if (event.section === 'staking') {
        console.debug()
        if (event.method === 'Rewarded') {
          const ex = {
            "index":"0x0701",
            "data":["144J3aDZgiCZ2X8aiPZ6HKuds3Zn6HNkkSQVNkWtHAgxYae7",3084992450]
          }
          const stash = event.data[0].toString()
          const amount = event.data[1]
          state.subscribers.forEach(sub => {
            // const c = state.candidates.find(f => f.stash === stash)
            if (sub.targets?.find(target => target.stash === stash)) {
              // const t = sub.targets[stash]
              try {
                bot.createMessage(
                  // '994441486575869952',
                  sub.channel.id,
                  'staking.Reward:'
                  + ` at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
                  // + `\t (phase=${phase.toString()})`
                  + `\n${stash}: ${amount/10000000000} DOT`
                )
              } catch (err) {
                bot.createMessage(
                  // '994441486575869952',
                  config.channel_id, // send message to me
                  'staking.Reward: ERROR: ' + err.toString()
                )
              }
            } else {
              slog('staking.Reward: skipping ' + stash)
            }
          })
        }
      }

      //// api.events.staking.StakersElected.is
      //if (event.section.toUpperCase() === 'STAKERSELECTED'
      //|| event.method.toUpperCase() === 'STAKERSELECTED') {
      //  // Show what we are busy with
      //  slog(`\t${event.section}:${event.method}:: (phase=${phase.toString()})`)
      //  bot.createMessage(
      //    // '994441486575869952',
      //    config.channel_id, // send message to me
      //    'Seems we have Event:'
      //      + `at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
      //      + `\t${event.section}:${event.method}:: (phase=${phase.toString()})`
      //  )
      //  // console.log(`\t\t${event.meta.documentation?.toString()}`)
      //
      //  // Loop through each of the parameters, displaying the type and data
      //  event.data.forEach((data, index) => {
      //      slog(`\t\t\t${types[index].type}: ${data.toString()}`);
      //  })
      //// } else {
      ////   console.log(`\t${event.section}:${event.method}:: (phase=${phase.toString()})`)
      //}

      //// staking-miner submits electionProviderMultiPhase.submit
      //if (event.section === 'electionProviderMultiPhase') {
      //  // && event.method.toUpperCase() === 'SUBMIT') {
      //  // console.log(event.section, event.method, phase.toString())
      //  console.log(event, phase.toString())
      //  bot.createMessage(
      //    // '994441486575869952',
      //    config.channel_id, // send message to me
      //    `at ${moment().format('YYYY.MM.DD HH:mm:ss')}`
      //      + `\t${event.section}:${event.method}:: (phase=${phase.toString()})`
      //  )
      //} // end of electionProviderMultiPhase.submit
      
    })
  })
  
  setInterval(async () => {
    slog('=== Interval starts...')
    // do we have any subscribers that need updated candidates data?
    var refreshNeeded = state.subscribers.findIndex(sub => {
      let age = moment().diff(moment(sub.updatedAt), 'seconds')
      return (age > sub.interval)
    })
    // if (!state.updatedAt || moment().diff(state.updatedAt, 'seconds') > 60) {
    slog(`refreshNeeded = ${refreshNeeded}`)
    if (refreshNeeded > -1 && moment().diff(state.updatedAt, 'seconds') > 60) { // 10 mins should be fresh enough
      slog('Updating candidates...')
      try {
        // const res = await axios.get('https://kusama.w3f.community/candidates')
        const res = await axios.get(config.candidates_url)
        if (res.data) {
          if (res.data.updatedAt) {
            // we're getting from our own cache
            state.candidates = res.data.candidates
            state.updatedAt = res.data.updatedAt
          } else {
            // we're getting from upstream
            state.candidates = res.data
            state.updatedAt = moment()  
          }
          saveState()
        } else {
          slog(res)
        }
      } catch (err) {
        slog('AXIOS error: ' + JSON.stringify(err.res ? err.res : err))
        console.debug(err)
      }
      // check if candidates are nominated
      try {
        const res = await axios.get(config.nominators_url)
        if (res.data) {
          state.nominators = res.data
          // loop througn all candidates
          for (let idx = 0; idx < state.candidates.length; idx++) {
            let stash = state.candidates[idx].stash
            let nominated = false
            if (state.nominators.find((n) => {
              // console.debug('checking if', stash, 'is nominated by', n.stash)
              const nomd = n.current.findIndex(c => c.stash === stash)
              // if (n.stash === '13EXScyZ9BzjpoiDJJ8UCEhQZcHNCEMv4bTwpzHv6CaJeZPT')
                // console.debug(stash, (nomd > -1) ? 'is'  : 'is not', 'nominated by', n.stash)
              return nomd > -1
            })) {
              nominated = true
            }
            console.debug('stash', stash, 'nominated =', nominated)
            state.candidates[idx].nominated = nominated
          }
          saveState()
        }
      } catch (err) {
        // slog(res)
        slog('Error fetching nominators')
        console.error(err)
      }
      // check if candidates are queued for next session
      slog('Checking if queued for next session')
      try {
        // const wsProvider = new WsProvider('wss://kusama-rpc.polkadot.io')
        const wsProvider = new WsProvider(config.rpc_url)
        const api = await ApiPromise.create({ provider: wsProvider })
        const keys = await api.query.session.queuedKeys()
        keys.forEach((k, idx) => {
          const stash = k.toJSON()[0]
          idx = state.candidates.findIndex(f => f.stash === stash)
          if (idx > -1) {
            state.candidates[idx].queued = true
          }
        })
        await api.disconnect()
      } catch (err) {
        console.debug(err)
      }
    }
    slog('Checking subscribers: '+ state.subscribers.length)
    let updated = false
    state.subscribers.forEach((sub, idx) => {
      let age = moment().diff(moment(sub.updatedAt), 'seconds')
      slog(`id: ${sub.id}, age: ${age}, updateAt ${sub.updatedAt}`)
      if (sub.updatedAt === '' || sub.updatedAt === undefined || age > sub.interval) {
        sub.targets?.forEach( t => {
          console.debug('Target', t, state.candidates.find(c => c.stash === t.stash))
          const c = new Candidate(state.candidates.find(c => c.stash === t.stash))
          console.debug('Candidate:', c)
          if (c) {
            // // const wasValid = c.valid
            const val_check = c.validity?.filter(f => !f.valid) || []
            // if (!c.valid) {
            //   // check validity
            //   bot.createMessage(
            //     '983358544650858507',
            //     'INVALID: '
            //     + '- ' + moment().format('YYYY.MM.DD HH:mm:ss') + ': \n'
            //     + '- ' + c.stash + ' \n'
            //     + JSON.stringify(c.valid) + ' \n'
            //     + JSON.stringify(c.validity) + ' \n'
            //     + JSON.stringify(c.invalidityReasons)
            //   )
        
            //   if (val_check.length == 0) c.valid = true
            // }
            c.valid = val_check.length === 0
            let message = composeStatusMessage(sub, c)
            bot.createMessage(sub.channel.id, message)
            if (!c.valid) bot.createMessage(sub.channel.id, JSON.stringify(val_check, null, 4))
          }
        })
        state.subscribers[idx].updatedAt = moment()
        updated = true
      }
    })
    if (updated) saveState()
    slog('=== Interval ends...')
  }, config.update_interval)
  
  bot.connect()

})()
