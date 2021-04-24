import { v4 as uuid } from "uuid";

class PromixedDB {
    constructor(name = "", upgrade = (error, event) => { }) {
        this.name = name;
        this.initialized = false;

        this.db = window.indexedDB;
        this.Transaction = window.IDBTransaction;
        this.KeyRange = window.IDBKeyRange;

        // this.db = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB; // make the database generic for most browsers

        // this.Transaction = window.IDBTransaction || this.webkitIDBTransaction || window.msIDBTransaction;// make the Transaction generic for most brosers

        // this.KeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange; //make the KeyRange generic for most browsers

        this.start(upgrade);
    }

    start(upgrade) {
        this.getVersion().then(version => {
            this.version = version;
            this.initialized = true;
            this.open(upgrade).then().catch(console.log);
        });
    }

    getVersion() {
        return new Promise((resolve) => {
            const request = this.db.open(this.name);

            request.onsuccess = () => {
                resolve(request.result.version);
            }
        });
    }

    async open(callback = (error, event) => { }) {
        if (!this.initialized) this.version = await this.getVersion();

        return await new Promise((resolve, reject) => {
            const upgrade = typeof callback == 'function';
            const request = this.db.open(this.name, upgrade ? ++this.version : this.version);// Open Database and initialize it

            request.onupgradeneeded = (event) => {
                // upgrade database if there is any changes in the database structure
                if (upgrade) {
                    const worked = callback(null, event.target.result);
                    // if callback is buggy reject it
                    if (worked) {
                        worked.onerror = workedEvent => {
                            reject(workedEvent.target.error);
                        }
                    }
                }
            }

            request.onsuccess = (event) => {
                this.initialized = true;
                resolve(event.target.result);
            }

            request.onerror = (event) => {
                if (typeof callback == 'function') {
                    callback(event.target.error, event.target.result);
                }
                reject(event.target.error);
            }
        });
    }

    isCollection(collection = "") {
        return this.open().then(db => {
            return db.objectStoreNames.contains(collection)
        });
    }

    createCollections(...collections) {
        return this.open((error, db) => {
            if (error) return Promise.reject(error);

            for (let collection of collections) {
                if (!db.objectStoreNames.contains(collection)) {// create if not already a collection
                    db.createObjectStore(collection, { keyPath: '_id' });
                }
            }

            return db;
        })
    }

    dropCollection(collection) {
        const data = { removed: 0, found: 0 };

        return new Promise((resolve))
    }

    emptyCollection(collection) {
        return this.deleteMany(collection, {});
    }

    async find(collection = "", document, options = { many: true }) {
        const db = await this.open();

        return new Promise((resolve, reject) => {
            const found = [];//store for matching documents

            if (db.objectStoreNames.contains(collection)) {
                let transaction = db.transaction(collection, 'readonly');//start transaction for read only

                transaction.onerror = (event) => {
                    db.close();
                    reject(event.target.error);
                }

                transaction.oncomplete = (event) => {
                    db.close();
                    resolve(options.many ? found : found[0]);
                }

                const store = transaction.objectStore(collection);
                const request = store.openCursor();
                let cursor;

                request.onerror = (event) => {
                    db.close();
                    reject(event.target.error);
                }

                request.onsuccess = (event) => {
                    cursor = event.target.result;
                    if (cursor) {
                        if (!document || !Object.keys(document).length) {//no document is being searched for?, add all
                            found.push(cursor.value);
                        }
                        else {
                            if (PromixedDB.isDocumentAttributes(cursor.value, document)) {// current document matches the searched document?
                                found.push(cursor.value);
                            }
                        }

                        cursor.continue();
                    }
                }
            }
            else {
                db.close();
                resolve(options.many ? found : found[0]);
            }
        });
    }

    findOne(collection = "", document) {
        return this.find(collection, document, { many: false });
    }

    findMany(collection = "", document) {
        return this.find(collection, document, { many: true });
    }

    async create(collection = "", data = [] || {}, options = { many: false }) {
        const db = await this.open();

        if (!db.objectStoreNames.contains(collection)) {
            await this.createCollections(collection);
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(collection, 'readwrite');

            transaction.onerror = (event) => {
                db.close();
                reject(event.target.error);
            }

            transaction.oncomplete = (event) => {
                db.close();
                resolve(data);
            }

            const request = transaction.objectStore(collection);

            if (options.many) {
                if (Array.isArray(data)) {
                    for (let i in data) {
                        data[i]._id = data[i]._id ? data[i]._id : uuid();
                        request.add(data);
                    }
                }
                else {
                    reject("For multiple insertion you have to provide a list of data");
                }
            }
            else {
                data._id = data._id ? data._id : uuid();
                request.add(data);
            }
        });
    }

    createOne(collection = '', data) {
        return this.create(collection, data, { many: false });
    }

    createMany(collection = '', data) {
        return this.create(collection, data, { many: true });
    }

    async update(collection = "", document, data, options = { many: true }) {
        const successful = [];
        const failed = [];
        let found = false;

        const db = await this.open();
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(collection)) {
                db.close();
                reject("Collection not found");
            }

            const transaction = db.transaction(collection, 'readwrite');

            transaction.onerror = (event) => {
                db.close();
                reject(event.target.error);
            }

            transaction.oncomplete = (event) => {
                db.close();
                resolve({ failed, successful });
            }

            const store = transaction.objectStore(collection);
            const request = store.openCursor();

            request.onerror = (event) => {
                db.close();
                reject(event.target.error);
            }

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor) {
                    if (PromixedDB.isDocumentAttributes(cursor.value, document)) {
                        found = true;
                        delete data._id;
                        const value = { ...cursor.value, ...data };

                        try {
                            const res = cursor.update(value);

                            res.onerror = (rEvent) => {
                                failed.push({ error: rEvent.target.error, _id: value._id });
                            }

                            res.onsuccess = (rEvent) => {
                                successful.push(value);
                            }

                        }
                        catch (error) {
                            db.close();
                            reject(error);
                        }
                    }
                }

                if (options.many || found == false) {
                    cursor.continue();
                }
            }
        });
    }

    updateOne(collection = "", document, data) {
        return this.update(collection, document, data, { many: false });
    }

    updateMany(collection = "", document, data) {
        return this.update(collection, document, data, { many: true });
    }

    async save(collection = "", document, data, options = { updateMany: true, createMany: false }) {
        const found = await this.findOne(collection, document);
        if (found) {
            return { action: 'update', data: await this.update(collection, document, data, { many: options.updateMany }) };
        }
        else {
            return { action: 'create', data: await this.create(collection, data, { many: options.createMany }) };
        }
    }

    saveOne(collection = "", document, data) {
        return this.save(collection, document, data, { updateMany: false, createMany: false });
    }

    saveMany(collection = "", document, data) {
        return this.save(collection, document, data, { updateMany: true, createMany: true });
    }

    async delete(collection = "", document, options = { many: true }) {
        const deleted = [];
        const ok = true;
        const found = await this.find(collection, document, options);

        return this.open().then(db => {
            const transaction = db.transaction(collection, 'readwrite');
            const store = transaction.objectStore(collection);

            transaction.onerror = (event) => {
                db.close();
                return Promise.reject(event.target.error);
            }

            transaction.oncomplete = (event) => {
                db.close();
                return options.many
                    ? { n: deleted.length, ok, found: found.length }
                    : deleted[0];
            }

            if (options.many) {
                for (let f of found) {
                    const request = store.delete(f._id);

                    request.onerror = (event) => {
                        ok = ok || false;
                    }

                    request.onsuccess = (event) => {
                        deleted.push(f);
                    }
                }
            }
            else if (found) {
                let request = store.delete(found._id);
                request.onerror = (event => {
                    return Promise.reject(event.target.error);
                });

                request.onsuccess = (event => {

                });
            }
        });


    }

    deleteOne(collection = "", document) {
        return this.delete(collection, document, { many: false });
    }

    deleteMany(collection = "", document) {
        return this.delete(collection, document, { many: true });
    }

    static isDocumentAttributes(document, attributes) {
        let flag = Object.keys(document).length > Object.keys(attributes).length
            && Object.keys(attributes).length > 0;

        for (let i in attributes) {
            if (!flag) break;

            flag = document[i] == attributes[i];
        }

        return flag;
    }
}

module.exports = PromixedDB;