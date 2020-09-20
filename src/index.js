'use strict'

function defaultSerializeFunction(session) {
  // Copy each property of the session to a new object
  const obj = {}
  let prop

  for (prop in session) {
    if (prop === 'cookie') {
      // Convert the cookie instance to an object, if possible
      // This gets rid of the duplicate object under session.cookie.data property
      obj.cookie = session.cookie.toJSON
        ? session.cookie.toJSON()
        : session.cookie
    } else {
      obj[prop] = session[prop]
    }
  }

  return obj
}

function computeTransformFunctions(options) {
  if (options.serialize || options.unserialize) {
    return {
      serialize: options.serialize || defaultSerializeFunction,
      unserialize: options.unserialize || (x => x),
    }
  }

  if (options.stringify === false) {
    return {
      serialize: defaultSerializeFunction,
      unserialize: x => x,
    }
  }
  // Default case
  return {
    serialize: JSON.stringify,
    unserialize: JSON.parse,
  }
}

module.exports = function(connect) {
  const Store = connect.Store || connect.session.Store
  const MemoryStore = connect.MemoryStore || connect.session.MemoryStore

  class FirebaseStore extends Store {
    constructor(options) {
      options = options || {}

      /* Fallback */
      if (options.fallbackMemory && MemoryStore) {
        return new MemoryStore()
      }

      super(options)

      /* Use crypto? */
      if (options.secret) {
        try {
          this.Crypto = require('./crypto.js')
          this.Crypto.init(options)
          delete options.secret
        } catch (error) {
          throw error
        }
      }

      /* Options */
      if (
        options.autoRemoveInterval &&
        options.autoRemoveInterval >
          71582 /* (Math.pow(2, 32) - 1) / (1000 * 60) */
      ) {
        throw new Error(
          'autoRemoveInterval is too large. options.autoRemoveInterval is in minutes but not seconds nor mills'
        )
      }
      this.ttl = options.ttl || 1209600 // 14 days
      this.collectionName = options.collection || 'sessions'
      this.autoRemove = options.autoRemove || 'native'
      this.autoRemoveInterval = options.autoRemoveInterval || 10 // Minutes
      this.writeOperationOptions = options.writeOperationOptions || {}
      this.transformFunctions = computeTransformFunctions(options)
      this.options = options

      this.changeState('init')

      const newConnectionCallback = (err, client) => {
        if (err) {
          this.connectionFailed(err)
        } else {
          this.handleNewConnectionAsync(client, options.dbName)
        }
      }

      if (options.url) {
        const firebaseAdmin = require("firebase-admin");
        const serviceAccount = require(options.url);
        if (!firebaseAdmin.inited){
          firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(serviceAccount),
            databaseURL: options.databaseURL
          });
          firebaseAdmin.inited = true;
          console.log("firebase inited");    
        }
        options.client = firebaseAdmin.firestore();
        this.handleNewConnectionAsync(options.client);

      } else if (options.client) {
        this.handleNewConnectionAsync(options.client)
      } else if (options.clientPromise) {
        options.clientPromise
          .then(client => this.handleNewConnectionAsync(client))
          .catch(err => this.connectionFailed(err))
      } else {
        throw new Error('Connection strategy not found')
      }

      this.changeState('connecting')
    }

    connectionFailed(err) {
      this.changeState('disconnected')
      throw err
    }

    handleNewConnectionAsync(client) {
      this.client = client
      return this.setCollection(this.collectionName)
        .setAutoRemoveAsync()
        .then(() => this.changeState('connected'))
    }

    setAutoRemoveAsync() {
      const removeQuery = () => {
        return { expires: { $lt: new Date() } }
      }
      switch (this.autoRemove) {
        case 'native':
          return Promise.resolve();
        case 'interval':
          this.timer = setInterval(
            () =>
              this.collection.deleteMany(
                removeQuery(),
                Object.assign({}, this.writeOperationOptions, {
                  w: 0,
                  j: false,
                })
              ),
            this.autoRemoveInterval * 1000 * 60
          )
          this.timer.unref()
          return Promise.resolve()
        default:
          return Promise.resolve()
      }
    }

    changeState(newState) {
      if (newState !== this.state) {
        this.state = newState
        this.emit(newState)
      }
    }

    setCollection(collectionName) {
      if (this.timer) {
        clearInterval(this.timer)
      }
      this.collectionReadyPromise = undefined
      this.collection = this.client.collection(collectionName);

      this.collection.findOne = async (_id)=>{
        let doc = await this.collection.doc(_id).get();

        let data = doc.data();
        if (data.expires) data.expires = data.expires.toDate();
        if (data.session.cookie) data.session.cookie.expires = data.session.cookie.expires.toDate();
        if (data.session.lastModified) data.session.lastModified = data.session.lastModified.toDate();
        if (data.lastModified) data.lastModified = data.lastModified.toDate();
        return data;
      }

      this.collection.listAll = async ()=>{
        let ref = await this.collection.get();
        let docs = ref.docs.map(doc=>doc.data());
        docs = docs.map(doc=>{
          if (doc.expires) doc.expires = doc.expires.toDate();
          if (doc.session.cookie) doc.session.cookie.expires = doc.session.cookie.expires.toDate();
          if (doc.session.lastModified) doc.session.lastModified = doc.session.lastModified.toDate();
          return doc;
        });
        return docs;
      }

      this.collection.drop = async ()=>{
        let batch = this.client.batch();
        let docs = await this.collection.listDocuments();
        for (let doc of docs){
          batch.delete(doc);
        }
        await batch.commit();
      };

      this.collection.countDocuments = async ()=>{
        let docs = await this.collection.listDocuments();
        return docs.length;
      };

      return this;
    }

    computeStorageId(sessionId) {
      if (
        this.options.transformId &&
        typeof this.options.transformId === 'function'
      ) {
        return this.options.transformId(sessionId)
      }
      return sessionId
    }

    /* Public API */

    async get(sid, callback) {
      let session = await this.collection.findOne(this.computeStorageId(sid));

      if (session.expires){
        let dt = new Date(session.expires);
        if (dt<(new Date())) session = null;
      }

      // console.log(session);

      if (session) {
        if (this.Crypto) {
          const tmpSession = this.transformFunctions.unserialize(
            session.session
          )
          session.session = this.Crypto.get(tmpSession)
        }
        const s = this.transformFunctions.unserialize(session.session)
        if (this.options.touchAfter > 0 && session.lastModified) {
          s.lastModified = session.lastModified
        }
        this.emit('get', sid)
        if (callback) callback(null, s)
        return s
      }
    }

    async set(sid, session, callback) {
      // Removing the lastModified prop from the session object before update
      if (this.options.touchAfter > 0 && session && session.lastModified) {
        delete session.lastModified
      }

      let s

      if (this.Crypto) {
        try {
          session = this.Crypto.set(session)
        } catch (error) {
          callback(null, error)
        }
      }

      try {
        s = {
          _id: this.computeStorageId(sid),
          session: this.transformFunctions.serialize(session),
        }
      } catch (err) {
        callback(null, err)
      }

      if (session && session.cookie && session.cookie.expires) {
        s.expires = new Date(session.cookie.expires)
      } else {
        // If there's no expiration date specified, it is
        // browser-session cookie or there is no cookie at all,
        // as per the connect docs.
        //
        // So we set the expiration to two-weeks from now
        // - as is common practice in the industry (e.g Django) -
        // or the default specified in the options.
        s.expires = new Date(Date.now() + this.ttl * 1000)
      }

      if (this.options.touchAfter > 0) {
        s.lastModified = new Date()
      }

      let _id = this.computeStorageId(sid);
      await this.collection.doc(_id).set(s);

      this.emit('upsert', sid);
      this.emit('set', sid);

      if (callback) callback(null)
    }

    async touch(sid, session, callback) {
      const updateFields = {}
      const touchAfter = this.options.touchAfter * 1000
      const lastModified = session.lastModified
        ? session.lastModified.getTime()
        : 0
      const currentDate = new Date()

      // If the given options has a touchAfter property, check if the
      // current timestamp - lastModified timestamp is bigger than
      // the specified, if it's not, don't touch the session
      if (touchAfter > 0 && lastModified > 0) {
        const timeElapsed = currentDate.getTime() - session.lastModified

        if (timeElapsed < touchAfter) {
          if (callback) callback(null)
        }
        updateFields.lastModified = currentDate
      }

      if (session && session.cookie && session.cookie.expires) {
        updateFields.expires = new Date(session.cookie.expires)
      } else {
        updateFields.expires = new Date(Date.now() + this.ttl * 1000)
      }

      let _id = this.computeStorageId(sid);
      const result = await this.collection.doc(_id).update(updateFields)

      if (result.nModified === 0) {
        throw new Error('Unable to find the session to touch')
      } else {
        this.emit('touch', sid, session)
      }

      if (callback) callback(null)
    }

    async all(callback) {
      let sessions = await this.collection.listAll();
      sessions = sessions.filter((session)=>{
        if (session.expires){
          let dt = new Date(session.expires);
          let now = new Date();
          return dt > now;
        }
        return true;
      });

      const results = []
      for (const session of sessions) {
        results.push(this.transformFunctions.unserialize(session.session))
      }

      this.emit('all', results)

      if (callback) callback(null, results)
      return results
    }

    async destroy(sid, callback) {
      await this.collection.doc(this.computeStorageId(sid)).delete();
      this.emit('destroy', sid)
      if (callback) callback(null)
    }

    async length(callback) {
      const len = await this.collection.countDocuments()
      if (callback) callback(null, len)
      return len
    }

    async clear(callback) {
      await this.collection.drop();
      if (callback) callback();
    }

    close() {
    }
  }

  return FirebaseStore
}
