const db = require('./dbInit')
const initExpress = require('./initExpress')
const {scheduleJob} = require('./schedule')
const {initQueues, mq} = require('./mq')
const blockchain = require('./blockchain')
const {loggers: {logger: baseLogger}} = require('@welldone-software/node-toolbelt')
const context = require('./context')

const defaultConfig = {
  clientRootDist: '',
  databaseUrl: '',
  models: (sequalize) => {}, // eslint-disable-line no-unused-vars
  initRoutesFunc: (router, createEndpoint, secure) => {}, // eslint-disable-line no-unused-vars
  jobs: [],
  apis: [],
  queueConnectionConfig: null,
  consumerQueues: {},
  rpcQueues: {},
  web3Url: '',
  contractsDirPath: '',
}

const queueCallback = (message) => {} // eslint-disable-line no-unused-vars
const noopJobDefinition = {cron: '', job: () => {}} // eslint-disable-line no-unused-vars

class ServiceConfigurationBuilder {
  constructor(builderFunc) {
    this.config = Object.assign({}, defaultConfig)
    builderFunc(this)
  }

  db(databaseUrl, models) {
    this.config.databaseUrl = databaseUrl
    this.config.models = models
  }

  blockchain(web3Url, contractsDirPath, contractsBinDirPath) {
    this.config.web3Url = web3Url
    this.config.contractsDirPath = contractsDirPath
    this.config.contractsBinDirPath = contractsBinDirPath
  }

  addApi(apiServerConfig) {
    this.config.apis.push(apiServerConfig)
  }

  addApis(apiServerConfigs) {
    this.config.apis = [...apiServerConfigs, ...this.config.apis]
  }

  static toQueueSpec(listeners = {}) {
    return Object.entries(listeners).map(([method, handler]) => ({method, handler}))
  }

  addQueues(connectionConfig, {listeners, rpcListeners} = {}) {
    this.config.queueConnectionConfig = connectionConfig
    this.config.consumerQueues = ServiceConfigurationBuilder.toQueueSpec(listeners)
    this.config.rpcQueues = ServiceConfigurationBuilder.toQueueSpec(rpcListeners)
  }

  /**
   * @param {noopJobDefinition} jobDefintion
   */
  addJob(name, {cron, job}) {
    this.config.jobs.push({name, cron, job})
  }

  addJobs(jobs) {
    Object.entries(jobs).forEach(([name, jobConfig]) => this.addJob(name, jobConfig))
  }
}

const initContext = (ctx, serviceContext) => {
  Object.keys(ctx).forEach((prop) => {
    if (prop in serviceContext) {
      Object.assign(serviceContext[prop], ctx[prop])
    } else {
      serviceContext[prop] = ctx[prop]
    }
  })
}

/**
 * @callback builderCallback
 * @param {ServiceConfigurationBuilder} builder
 */
const noopBuilder = (builder) => {} // eslint-disable-line no-unused-vars

/**
 * @param {String} serviceName
 * @param {noopBuilder} builderFunc
 */
const createService = async (serviceName, builderFunc) => {
  const logger = baseLogger.child({name: serviceName})
  context.logger = logger
  context.serviceName = serviceName

  const {config} = new ServiceConfigurationBuilder(builderFunc)

  if (config.databaseUrl) {
    if (!config.models) {
      throw new Error('db is missing required \'models\' param')
    }
    await db.dbInit(config.databaseUrl, config.models)
  }

  if (config.web3Url) {
    blockchain.init(config.web3Url, config.contractsDirPath, config.contractsBinDirPath)
  }

  if (config.queueConnectionConfig) {
    await initQueues(config)
  }

  const apis = await Promise.all(config.apis.map(apiServerConfig => initExpress(apiServerConfig, serviceName)))
  config.jobs.forEach(({name, cron, job}) => scheduleJob(name, cron, job))

  return {
    mq,
    db,
    blockchain,
    logger,
    apis,
  }
}

module.exports = {createService, initContext}
