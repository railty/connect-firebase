'use strict'

const expressSession = require('express-session')
const FirebaseStore = require('..')(expressSession)

const futureDate = new Date(2030, 1)

const connectionString = process.env.FIREBASE_URL || "../nodebb-b6fcd-firebase-adminsdk-bxuro-47124988dd.json"
const databaseURL = "https://nodebb-b6fcd.firebaseio.com";

function noop() {}

describe('Events', () => {
  let store, collection
  beforeEach(function(done) {
    store = new FirebaseStore({
      url: connectionString,
      databaseURL: databaseURL,
      collection: 'sessions-test',
    })
    store.once('connected', async () => {
      collection = store.collection
      await collection.drop();
      done();
    })
  })
  afterEach(() => {
    return store.close()
  })

  describe('set() with an unknown session id', () => {
    it('should emit a `create` event', async (done) => {
      store.once('upsert', sid => {
        expect(sid).toBe('foo1')
        done()
      })
      await store.set('foo1', { foo: 'bar' }, noop)
    })
    it('should emit a `set` event', async (done) => {
      store.once('set', sid => {
        expect(sid).toBe('foo2')
        done()
      })
      await store.set('foo2', { foo: 'bar' }, noop)
    })
  })

  describe('set() with a session id associated to an existing session', () => {
    it('should emit an `update` event', async (done) => {
      store.once('upsert', sid => {
        expect(sid).toBe('foo3')
        done()
      })
      await collection.doc('foo3').set({ _id: 'foo3', session: { foo: 'bar1' }, expires: futureDate })
      await store.set('foo3', { foo: 'bar2' }, noop)
    })
    it('should emit an `set` event', async (done) => {
      store.once('upsert', sid => {
        expect(sid).toBe('foo4')
        done()
      })
      await collection.doc('foo4').set({ _id: 'foo4', session: { foo: 'bar1' }, expires: futureDate });
      await store.set('foo4', { foo: 'bar2' }, noop);
    })
  })
})

describe('Events w/ Crypto', () => {
  let store, collection
  beforeEach(function(done) {
    store = new FirebaseStore({
      url: connectionString,
      collection: 'sessions-test',
      secret: 'squirrel',
    })
    store.once('connected', async () => {
      collection = store.collection
      await collection.drop();
      done();
    })
  })
  afterEach(() => {
    return store.close()
  })

  describe('set() with an unknown session id', () => {
    it('should emit a `create` event', async(done) => {
      store.once('upsert', sid => {
        expect(sid).toBe('foo1')
        done()
      })
      await store.set('foo1', { foo: 'bar' }, noop)
    })
    it('should emit a `set` event', async(done) => {
      store.once('set', sid => {
        expect(sid).toBe('foo2')
        done()
      })
      await store.set('foo2', { foo: 'bar' }, noop)
    })
  })

  describe('set() with a session id associated to an existing session', () => {
    it('should emit an `update` event', async(done) => {
      store.once('upsert', sid => {
        expect(sid).toBe('foo3')
        done()
      })
      await collection.doc('foo3').set({ _id: 'foo3', session: { foo: 'bar1' }, expires: futureDate });
      await store.set('foo3', { foo: 'bar2' }, noop)
    })

    it('should emit an `set` event', async (done) => {
      store.once('upsert', sid => {
        expect(sid).toBe('foo4')
        done()
      })
      await collection.doc('foo4').set({ _id: 'foo4', session: { foo: 'bar1' }, expires: futureDate });
      await store.set('foo4', { foo: 'bar2' }, noop);
    })
  })
})
