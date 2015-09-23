process.env.NODE_ENV = 'test';

var ArgumentError = require('./errors').ArgumentError;
var DatabaseError = require('./errors').DatabaseError;
var SemanticsError = require('./errors').SemanticsError;
var DatabaseHandler = require('./databaseHandler');
var UserSecurity = require('./userSecurity');
var config = require('./config');
var strings = require('./strings');

var Q = require('q');
var sanitizer = require('sanitizer');

var errorHandler = function(response, err) {
  if (err instanceof ArgumentError) {
    response.status(400).send(err.message);
  }
  else if (err instanceof SemanticsError) {
    response.status(422).send(err.message);
  }
  else if (err instanceof DatabaseError) {
    response.status(503).send(err.message);
  }
  else {
    response.status(500).send(err.message);
  }
};

var RequestHandler = function() {
  dbHandler = new DatabaseHandler();
  scope = this;

  this.connect = function() {
    return dbHandler.connect();
  };

  this.close = function() {
    dbHandler.close();
  };

  var hasAccess = function(id, req) {
    return Q.Promise(function(resolve, reject, notify) {
      if(id === req.session._id) resolve(true);
      else {
        dbHandler.checkIfFriends(id, req.session._id)
        .then(resolve)
        .catch(reject);
      }
    });
  };

  this.checkToken = function(token, id) {
    return Q.Promise(function(resolve, reject, notify) {
      dbHandler.getUser({_id: id})
      .then((user) => resolve(user.token === token, reject))
      .catch(reject);
    });
  };

  this.getUsersById = function(req, res) {
    if (!req.query.ids) errorHandler(res, new ArgumentError(strings.noParamId));
    else {
      var ids = JSON.parse(req.query.ids);
      if(!Array.isArray(ids)) errorHandler(res, new ArgumentError(strings.invalidIds));
      else {
        dbHandler.getManyById(ids)
        .then((users) => res.status(200).json(
            users.map((user) => ({ _id: user._id, username: user.username}))),
          (err) => errorHandler(res, err));
      }
    }
  };

  this.register = function(req, res) {
    if (req.session.loggedIn) errorHandler(res, new ArgumentError(strings.alreadyLoggedIn));
    else if (!req.body.username || !req.body.password) errorHandler(res, new ArgumentError(strings.missingParams));
    else if(req.body.password.length < config.get('security:passwords:minLength'))
      errorHandler(res, new ArgumentError(strings.passwordTooShort));
    else {
      UserSecurity.hash(req.body.password)
      .then((hash) => ({username: req.body.username, password: hash}))
      .then((params) => dbHandler.registerUser(params))
      .then(function(user) {
        scope.login(req, res);
      })
      .catch((err) => errorHandler(res, err));
    }
  };

  this.login = function(req, res) {
    if (req.session.loggedIn) errorHandler(res, new ArgumentError(strings.alreadyLoggedIn));
    else if (!req.body.username || !req.body.password) errorHandler(res, new ArgumentError(strings.missingParams));
    else {
      var user = null;
      dbHandler.getUser({username: req.body.username})
      .then((_user) => user = _user)
      .then(() => { if (!user) throw new SemanticsError(strings.noUser); })
      .then(() => UserSecurity.verifyHash(req.body.password, user.password))
      .then((res) => { if (!res) throw new SemanticsError(strings.passwordIncorrect); })
      .then(function() {
        req.session._id = user._id;
        req.session.username = user.username;
        req.session.token = user.token;
        req.session.loggedIn = true;
        res.status(200).json({username: user.username, _id: user._id});
      })
      .catch((err) => errorHandler(res, err));
    }
  };

  this.logout = function(req, res) {
    if (!req.session.loggedIn) errorHandler(res, new ArgumentError(strings.notLoggedIn));
    else {
      req.session.reset();
      res.sendStatus(204);
    }
  };

  this.resetSessions = function(req, res) {
    if (!req.session.loggedIn) errorHandler(res, new ArgumentError(strings.notLoggedIn));
    else {
      dbHandler.updateToken(req.session._id)
      .then(() => scope.logout(req, res))
      .catch((err) => errorHandler(res, err));
    }
  };

  this.updatePassword = function(req, res) {
    if (!req.session.loggedIn) errorHandler(res, new ArgumentError(strings.notLoggedIn));
    else if (!req.body.password) errorHandler(res, new ArgumentError(strings.noParamPassword));
    else if(req.body.password.length < config.get('security:passwords:minLength'))
      errorHandler(res, new ArgumentError(strings.passwordTooShort));
    else {
      var reset = req.body.reset ? true : false;
      UserSecurity.hash(req.body.password)
      .then(function(pw) {
        dbHandler.updatePassword(req.session._id, pw, reset)
        .then(() => res.sendStatus(204))
        .done();
      });
    }
  };

  this.getProfile = function(req, res) {
    if (!req.session.loggedIn) errorHandler(res, new ArgumentError(strings.notLoggedIn));
    else if (!req.query.id) errorHandler(res, new ArgumentError(strings.noParamId));
    else {
      hasAccess(req.query.id, req)
      .then((res) => { if (!res) throw new ArgumentError(strings.noAccess); })
      .then(() => dbHandler.getUser({_id: req.query.id}))
      .then(function(user) {
        return Q.Promise(function(resolve, reject) {
          var params = {_id: user._id, username: user.username };
          dbHandler.getMessages(user._id)
          .then((messages) => params.messages = messages)
          .then(() => resolve(params), reject);
        });
      })
      .then(function(result) {
        dbHandler.getMessages(result._id)
        .then((messages) => result.messages = messages);
        return result;
      })
      .then((result) => res.status(200).json(result))
      .catch((err) => errorHandler(res, err))
      .done();
    }
  };

  this.search = function(req, res) {
    if(!req.session.loggedIn) errorHandler(res, new ArgumentError("User not logged in"));
    else if(!req.query.searchword) errorHandler(res, new ArgumentError("Missing parameter 'searchword'"));
    else {
      dbHandler.searchUsers(req.query.searchword)
      .then(function(result) {
        return result.map((user) => ({_id: user._id, username: user.username}));
      })
      .then((users) => res.status(200).json(users))
      .catch((err) => errorHandler(res, err))
      .done();
    }
  };

  this.sendMessage = function(req, res) {
    if(!req.session.loggedIn) errorHandler(res, new ArgumentError(strings.notLoggedIn));
    else if(!req.body.receiver) errorHandler(res, new ArgumentError(strings.noParamReceiver));
    else if(!req.body.message) errorHandler(res, new ArgumentError(strings.noParamMessage));
    else if(req.body.message.length > config.get('messages:maxLength')) errorHandler(res, new SemanticsError(strings.messageTooLong));
    else {
      var msg = sanitizer.escape(req.body.message);
      hasAccess(req.body.receiver, req)
      .then((res) => { if (!res) throw new ArgumentError(strings.noAccess); })
      .catch((err) => errorHandler(res, err))
      .done();
    }
  };
};

module.exports = RequestHandler;
/* istanbul ignore else */
if (process.env.NODE_ENV === 'test') {
  module.exports._private = { errorHandler: errorHandler };
}
