FROM node:18-alpine

RUN apk add g++ make py3-pip
RUN mkdir -p /home/app && chown -R node:node /home/app
RUN mkdir -p /home/state && chown -R node:node /home/state
WORKDIR /home/app

# we exclude the package-lock.json
COPY package.json ./
COPY bot.js ./
COPY candidate.js ./
COPY config.js ./
RUN mkdir ./state

# state.json is the persistent storage
# COPY state.json ./

USER node
RUN npm install

# VOLUME [ "/data" ]
# not needed, we mount state/{chainId}-state.json to /home/state/{chainId}-state.json

EXPOSE 3000

CMD ["npm", "start"]
