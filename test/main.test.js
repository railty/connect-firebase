'use strict'

const expressSession = require('express-session')
const FirebaseStore = require('..')(expressSession)
const assert = require('assert')

const connectionString = process.env.FIREBASE_URL || "../nodebb-b6fcd-firebase-adminsdk-bxuro-47124988dd.json"
const databaseURL = "https://nodebb-b6fcd.firebaseio.com";

const firebaseAdmin = require("firebase-admin");

// Create a connect cookie instance
const makeCookie = function() {
  const cookie = new expressSession.Cookie()
  cookie.maxAge = 10000 // This sets cookie.expire through a setter
  cookie.secure = true
  cookie.domain = 'cow.com'
  cookie.sameSite = false

  return cookie
}

// Create session data
const makeData = function() {
  return {
    foo: 'bar',
    baz: {
      cow: 'moo',
      chicken: 'cluck',
    },
    num: 1,
    cookie: makeCookie(),
  }
}

const makeDataNoCookie = function() {
  return {
    foo: 'bar',
    baz: {
      cow: 'moo',
      fish: 'blub',
      fox: 'nobody knows!',
    },
    num: 2,
  }
}

// Given a session id, input data, and session, make sure the stored data matches in the input data
const assertSessionEquals = function(sid, data, session) {
  if (typeof session.session === 'string') {
    // Compare stringified JSON
    assert.strictEqual(session.session, JSON.stringify(data))
  } else {
    // Can't do a deepEqual for the whole session as we need the toJSON() version of the cookie
    // Make sure the session data in intact
    for (const prop in session.session) {
      if (prop === 'cookie') {
        // Make sure the cookie is intact
        assert.deepStrictEqual(session.session.cookie, data.cookie.toJSON())
      } else {
        assert.deepStrictEqual(session.session[prop], data[prop])
      }
    }
  }

  // Make sure the ID matches
  assert.strictEqual(session._id, sid)
}

const openDb = function(options, callback) {
  const store = new FirebaseStore(options)
  store.once('connected', function() {
    callback(this, this.collection)
  })
}

async function cleanup(store, collection, callback) {
  await collection.drop();
  await store.close();
  callback();
}

function getFirebaseConnection(options, done) {
  if (!done) {
    done = options
    options = {}
  }

  const serviceAccount = require(connectionString);
  if (!firebaseAdmin.inited){
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount),
      databaseURL: databaseURL
    });
    firebaseAdmin.inited = true;
    console.log("firebase inited");    
  }
  let client = firebaseAdmin.firestore();
  openDb(Object.assign(options, { client }), done)
}


describe('legacy tests', () => {
  test('test_set', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_set-sid'
      const data = makeData()

      await store.set(sid, data);
      let session = await collection.findOne(sid);
      assertSessionEquals(sid, data, session);
      cleanup(store, collection, done)
    })
  })

  test('test_set_promise', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_set_promise-sid'
      const data = makeData()
      await store.set(sid, data)
      // Verify it was saved
      const session = await collection.findOne(sid);
      assertSessionEquals(sid, data, session)
      cleanup(store, collection, done)
    })
  })

  test('test_set_event', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_set_promise-sid'
      const data = makeData()
      store.on('set', async sessionId => {
        // Verify it was saved
        const session = await collection.findOne(sid)
        assertSessionEquals(sid, data, session)
        cleanup(store, collection, done)
      })
      store.set(sid, data)
    })
  })

  test('test_set_no_stringify', done => {
    getFirebaseConnection({ stringify: false }, async (store, collection) => {
        const sid = 'test_set-sid'
        const data = makeData()
        await store.set(sid, data)
        // Verify it was saved
        const session = await collection.findOne(sid)
        assertSessionEquals(sid, data, session)
        cleanup(store, collection, done)
      }
    )
  })

  test('test_session_cookie_overwrite_no_stringify', done => {
    getFirebaseConnection({ stringify: false }, async (store, collection) => {
        const origSession = makeData()
        const cookie = origSession.cookie
        const sid = 'test_set-sid'
        await store.set(sid, origSession)
        const session = await collection.findOne(sid)

        // Make sure cookie came out intact
        assert.strictEqual(origSession.cookie, cookie)

        // Make sure the fields made it back intact
        assert.strictEqual(
          cookie.expires.toJSON(),
          session.session.cookie.expires.toJSON()
        )
        assert.strictEqual(cookie.secure, session.session.cookie.secure)

        cleanup(store, collection, done)
      }
    )
  })

  test('test_get', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_get-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      store.get(sid, (err, session) => {
        assert.strictEqual(err, null)
        assert.deepStrictEqual(session, testData)
        cleanup(store, collection, done)
      })
    })
  })

  test('test_get_promise', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_get_promise-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      const session = await store.get(sid)
      assert.deepStrictEqual(session, testData)
      cleanup(store, collection, done)
    })
  })

  test('test_all', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_all-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      store.all((err, sessions) => {
        assert.strictEqual(err, null)
        assert.strictEqual(sessions.length, 1)
        assert.deepStrictEqual(sessions[0], testData)
        cleanup(store, collection, done)
      })
    })
  })

  test('test_all_promise', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_all_promise-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      const sessions = await store.all()
      assert.strictEqual(sessions.length, 1)
      assert.deepStrictEqual(sessions[0], testData)
      cleanup(store, collection, done)
    })
  })

  test('test_length', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_length-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      store.length((err, length) => {
        assert.strictEqual(err, null)
        assert.strictEqual(length, 1)
        cleanup(store, collection, done)
      })
    })
  })

  test('test_length_promise', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_length_promise-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      const length = await store.length()
      assert.strictEqual(length, 1)
      cleanup(store, collection, done)
    })
  })

  test('test_destroy_ok', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_destroy_ok-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      store.destroy(sid, err => {
        assert.strictEqual(err, null)
        cleanup(store, collection, done)
      })
    })
  })

  test('test_destroy_ok_promise', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_destroy_ok_promise-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      await store.destroy(sid)
      cleanup(store, collection, done)
    })
  })

  test('test_destroy_ok_event', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_destroy_ok_event-sid'
      const testData = { key1: 1, key2: 'two' }
      await collection.doc(sid).set({
        _id: sid,
        session: JSON.stringify(testData),
      })
      store.on('destroy', sessionId => {
        expect(sessionId).toBe(sid)
        cleanup(store, collection, done)
      })
      store.destroy(sid)
    })
  })

  test('test_clear', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_length-sid'
      const testData = { _id: sid, key1: 1, key2: 'two' }
      await collection.doc(sid).set(testData)
      store.clear(async () => {
        const count = await collection.countDocuments()
        assert.strictEqual(count, 0)
        await store.close()
        done()
      })
    })
  })

  test('test_clear_promise', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_length-sid'
      const testData = { _id: sid, key1: 1, key2: 'two' }
      await collection.doc(sid).set(testData)
      await store.clear()
      const count = await collection.countDocuments()
      assert.strictEqual(count, 0)
      await store.close()
      done()
    })
  })

  test('test_options_url', done => {
    const store = new FirebaseStore({
      url: connectionString,
      collection: 'sessions-test',
    })
    store.once('connected', function() {
      assert.strictEqual(store.collectionName, 'sessions-test')
      store.close();
      done();
    })
  })

  test('test_options_no_db', () => {
    expect(() => {
      return new FirebaseStore({})
    }).toThrow()
  })

  // Memory store ONLY support callback but not promise!
  test('test_set_with_memory_db', done => {
    const store = new FirebaseStore({ fallbackMemory: true })
    const sid = 'test_set_memory-sid'
    const data = makeData()
    store.set(sid, data, async err => {
      expect(err).toBeFalsy()
      store.get(sid, (err, session) => {
        assert.strictEqual(err, null)
        for (const prop in session.session) {
          if (prop === 'cookie') {
            // Make sure the cookie is intact
            assert.deepStrictEqual(session.session.cookie, data.cookie.toJSON())
          } else {
            assert.deepStrictEqual(session.session[prop], data[prop])
          }
        }
        done()
      })
    })
  })
  
  test('test_set_default_expiration', done => {
    const defaultTTL = 10
    getFirebaseConnection(
      { ttl: defaultTTL },
      async (store, collection) => {
        const sid = 'test_set_expires-sid'
        const data = makeDataNoCookie()
        const timeBeforeSet = new Date().valueOf()
        await store.set(sid, data)
        const session = await collection.findOne(sid)
        assert.deepStrictEqual(session.session, JSON.stringify(data))
        assert.strictEqual(session._id, sid)
        assert.notStrictEqual(session.expires, null)
        const timeAfterSet = new Date().valueOf()
        assert.ok(
          timeBeforeSet + defaultTTL * 1000 <= session.expires.valueOf()
        )
        assert.ok(session.expires.valueOf() <= timeAfterSet + defaultTTL * 1000)
        cleanup(store, collection, done)
      }
    )
  })

  test('test_set_without_default_expiration', done => {
    const defaultExpirationTime = 1000 * 60 * 60 * 24 * 14
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_set_expires-sid'
      const data = makeDataNoCookie()
      const timeBeforeSet = new Date().valueOf()
      await store.set(sid, data)
      const session = await collection.findOne(sid)
      assert.deepStrictEqual(session.session, JSON.stringify(data))
      assert.strictEqual(session._id, sid)
      assert.notStrictEqual(session.expires, null)
      const timeAfterSet = new Date().valueOf()
      assert.ok(
        timeBeforeSet + defaultExpirationTime <= session.expires.valueOf()
      )
      assert.ok(
        session.expires.valueOf() <= timeAfterSet + defaultExpirationTime
      )
      cleanup(store, collection, done)
    })
  })

  test('test_set_custom_serializer', done => {
    getFirebaseConnection(
      {
        serialize(obj) {
          obj.ice = 'test-1'
          return JSON.stringify(obj)
        },
      },
      async (store, collection) => {
        const sid = 'test_set_custom_serializer-sid'
        const data = makeData()
        const dataWithIce = JSON.parse(JSON.stringify(data))
        dataWithIce.ice = 'test-1'
        await store.set(sid, data)
        const session = await collection.findOne(sid)
        assert.deepStrictEqual(session.session, JSON.stringify(dataWithIce))
        assert.strictEqual(session._id, sid)
        cleanup(store, collection, done)
      }
    )
  })

  test('test_get_custom_unserializer', done => {
    getFirebaseConnection(
      {
        unserialize(obj) {
          obj.ice = 'test-2'
          return obj
        },
      },
      async (store, collection) => {
        const sid = 'test_get_custom_unserializer-sid'
        const data = makeData()
        await store.set(sid, data)
        const session = await store.get(sid)
        data.ice = 'test-2'
        data.cookie = data.cookie.toJSON()
        assert.deepStrictEqual(session, data)
        cleanup(store, collection, done)
      }
    )
  })

  test('test_session_touch', done => {
    getFirebaseConnection(async (store, collection) => {
      const sid = 'test_touch-sid'
      const data = makeData()
      await store.set(sid, data)
      const session = await collection.findOne(sid)
      assertSessionEquals(sid, data, session)
      await store.touch(sid, session.session)
      const session2 = await collection.findOne(sid)
      // Check if both expiry date are different
      assert.ok(session2.expires.getTime() > session.expires.getTime())
      cleanup(store, collection, done)
    })
  })

  test('test_session_lazy_touch_sync', done => {
    getFirebaseConnection({ touchAfter: 2 }, async (store, collection) => {
      const sid = 'test_lazy_touch-sid-sync'
      const data = makeData()
      await store.set(sid, data)
      const session = await collection.findOne(sid)
      const lastModifiedBeforeTouch = Math.floor(
        session.lastModified.getTime() / 1000 / 10
      )
      await store.touch(sid, session)
      const session2 = await collection.findOne(sid)
      const lastModifiedAfterTouch = Math.floor(
        session2.lastModified.getTime() / 1000 / 10
      )
      assert.strictEqual(lastModifiedBeforeTouch, lastModifiedAfterTouch)
      cleanup(store, collection, done)
    })
  })

  test('test_session_lazy_touch_async', done => {
    getFirebaseConnection({ touchAfter: 2 }, async (store, collection) => {
      const sid = 'test_lazy_touch-sid'
      const data = makeData()
      await store.set(sid, data)
      const session = await collection.findOne(sid)
      const lastModifiedBeforeTouch = session.lastModified.getTime()
      setTimeout(async () => {
        await store.touch(sid, session)
        const session2 = await collection.findOne(sid)
        const lastModifiedAfterTouch = session2.lastModified.getTime()
        assert.ok(lastModifiedAfterTouch > lastModifiedBeforeTouch)
        cleanup(store, collection, done)
      }, 2200)
    })
  })

})
