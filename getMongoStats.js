/* global db, tojson, tojsononeline, rs, print, printjson */

/* =================================================
 * getMongoStats.js: MongoDB Stats Report
 * =================================================
 *
 * Gather MongoDB stats for the databases and the collections.
 *
 * To execute on a locally running mongod on default port (27017) without
 * authentication, run:
 *
 *     mongo getMongoStats.js > getMongoStats.log
 *
 * To execute on a remote mongod or mongos with authentication, run:
 *
 *     mongo HOST:PORT/admin -u ADMIN_USER -p ADMIN_PASSWORD getMongoStats.js > getMongoStats.log
 *
 * DISCLAIMER
 *
 * Please note: all tools/ scripts in this repo are released for use "AS
 * IS" without any warranties of any kind, including, but not limited to
 * their installation, use, or performance. We disclaim any and all
 * warranties, either express or implied, including but not limited to
 * any warranty of noninfringement, merchantability, and/ or fitness for
 * a particular purpose. We do not warrant that the technology will
 * meet your requirements, that the operation thereof will be
 * uninterrupted or error-free, or that any errors will be corrected.
 *
 * Any use of these scripts and tools is at your own risk. There is no
 * guarantee that they have been through thorough testing in a
 * comparable environment and we are not responsible for any damage
 * or data loss incurred with their use.
 *
 * You are responsible for reviewing and testing any scripts you run
 * thoroughly before use in any non-testing environment.
 */

var _version = "1.0.3";

(function () {
   "use strict";
}());

// For MongoDB 2.4 and before
if (DB.prototype.getUsers == null) {
    DB.prototype.getUsers = function (args) {
        var cmdObj = {usersInfo: 1};
        Object.extend(cmdObj, args);
        var res = this.runCommand(cmdObj);
        if (!res.ok) {
            var authSchemaIncompatibleCode = 69;
            if (res.code == authSchemaIncompatibleCode ||
                    (res.code == null && res.errmsg == "no such cmd: usersInfo")) {
                // Working with 2.4 schema user data
                return this.system.users.find({}).toArray();
            }
            throw Error(res.errmsg);
        }
        return res.users;
    }
}

// For MongoDB 2.4 and before
if (DB.prototype.getRoles == null) {
    DB.prototype.getRoles = function (args) {
        return "No custom roles";
    }
}

// Taken from the >= 3.1.9 shell to capture print output
if (typeof print.captureAllOutput === "undefined") {
    print.captureAllOutput = function (fn, args) {
        var res = {};
        res.output = [];
        var __orig_print = print;
        print = function () {
            Array.prototype.push.apply(res.output, Array.prototype.slice.call(arguments).join(" ").split("\n"));
        };
        try {
            res.result = fn.apply(undefined, args);
        }
        finally {
            // Stop capturing print() output
            print = __orig_print;
        }
        return res;
    };
}

// Convert NumberLongs to strings to save precision
function longmangle(n) {
    if (! n instanceof NumberLong)
        return null;
    var s = n.toString();
    s = s.replace("NumberLong(","").replace(")","");
    if (s[0] == '"')
        s = s.slice(1, s.length-1)
    return s;
}

// For use in JSON.stringify to properly serialize known types
function jsonStringifyReplacer(k, v){
    if (v instanceof ObjectId)
        return { "$oid" : v.valueOf() };
    if (v instanceof NumberLong)
        return { "$numberLong" : longmangle(v) };
    if (v instanceof NumberInt)
        return v.toNumber();
    // For ISODates; the $ check prevents recursion
    if (typeof v === "string" && k.startsWith('$') == false){
        try {
            iso = ISODate(v);
            return { "$date" : iso.valueOf() };
        }
        // Nothing to do here, we'll get the return at the end
        catch(e) {}
    }
    return v;
}

function printInfo(message, command, section, printCapture) {
    var result = false;
    printCapture = (printCapture === undefined ? false: true);
    if (! _printJSON) print("\n** " + message + ":");
    startTime = new Date();
    try {
        if (printCapture) {
            result = print.captureAllOutput(command);
        } else {
            result = command();
        }
        err = null
    } catch(err) {
        if (! _printJSON) {
            print("Error running '" + command + "':");
            print(err);
        }
        result = null
    }
    endTime = new Date();
    doc = {};
    doc['command'] = command.toString();
    doc['error'] = err;
    doc['host'] = _host;
    doc['ref'] = _ref;
    doc['tag'] = _tag;
    doc['output'] = result;
    if (typeof(section) !== "undefined") {
        doc['section'] = section;
        doc['subsection'] = message.toLowerCase().replace(/ /g, "_");
    } else {
        doc['section'] = message.toLowerCase().replace(/ /g, "_");
    }
    doc['ts'] = {'start': startTime, 'end': endTime};
    doc['version'] = _version;
    _output.push(doc);
    if (! _printJSON) printjson(result);
    return result;
}

function printDataInfo(isMongoS) {
    section = "data_info";
    var dbs = printInfo('List of databases', function(){return db.getMongo().getDBs()}, section);

    if (dbs.databases) {
        dbs.databases.forEach(function(mydb) {
            var collections = printInfo("List of collections for database '"+ mydb.name +"'",
                                        function(){return db.getSiblingDB(mydb.name).getCollectionNames()}, section);

            printInfo('Database stats (MB)',
                      function(){return db.getSiblingDB(mydb.name).stats(1024*1024)}, section);

            if (collections) {
                collections.forEach(function(col) {
                    printInfo('Collection stats (MB)',
                              function(){return db.getSiblingDB(mydb.name).getCollection(col).stats(1024*1024)}, section);
                });
            }
        });
    }
}

function printShardOrReplicaSetInfo() {
    section = "shard_or_replicaset_info";
    var state;
    var stateInfo = rs.status();
    if (stateInfo.ok) {
        stateInfo.members.forEach( function( member ) { if ( member.self ) { state = member.stateStr; } } );
        if ( !state ) state = stateInfo.myState;
    } else {
        var info = stateInfo.info;
        if ( info && info.length < 20 ) {
            state = info; // "mongos", "configsvr"
        }
        if ( ! state ) state = "standalone";
    }
    if (state == "mongos") {
        return true;
    } else if (state != "standalone" && state != "configsvr") {
        if (state == "SECONDARY" || state == 2) {
            rs.slaveOk();
        }
    }
    return false;
}

if (typeof _printJSON === "undefined") var _printJSON = false;
if (typeof _ref === "undefined") var _ref = null;
var _output = [];
var _tag = ObjectId();
if (! _printJSON) {
    print("================================");
    print("MongoDB Statistics Report");
    print("getMongoStats.js version " + _version);
    print("================================");
}
var _host = hostname();
var isMongoS = printShardOrReplicaSetInfo();
printDataInfo(isMongoS);
if (_printJSON) print(JSON.stringify(_output, jsonStringifyReplacer, 4));
