# connect-firebase

This is a seesion store using firebase, based on the MongoDB session store from [connect-mongo](https://github.com/jdesboeufs/connect-mongo)

## What changed

1. only index.js changed, rewrite from promises to awaits, and use firebase instead of mongo.
2. all tests passed
3. an express example added 

## Performance

Performance is compariable to the remote database or mongo. it is slower than local database or mongo installation for obvious reason. and you cannot compare this with the in memory stores.

## License

The MIT License
