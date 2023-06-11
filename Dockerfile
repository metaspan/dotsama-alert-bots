FROM node:16-alpine

RUN apk add g++ make py3-pip
RUN mkdir -p /home/app && chown -R node:node /home/app
WORKDIR /home/app

# we exclude the package-lock.json
COPY package.json ./
COPY bot.js ./
COPY candidate.js ./
COPY config.js ./

# state.json is the persistent storage
# COPY state.json ./

USER node
RUN npm install

# VOLUME [ "/data" ]

EXPOSE 3000

CMD ["npm", "start"]
