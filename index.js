const PromisedDB = require('./utils/PromisedDB');

window.p = new PromisedDB('sample');


p.deleteOne('col', {name: 'kennedy'}, {age: 5, status: false}).then(console.log)

p.findOne('col', {}).then(console.log)
