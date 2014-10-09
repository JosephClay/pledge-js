(function(name, factory) {

    if (typeof define === 'function') { // RequireJS
        define(function() { return factory(); });
    } else if (typeof module !== 'undefined' && module.exports) { // CommonJS
        module.exports = factory();
    } else { // Browser
        this[name] = factory();
    }

})('pledge', function(undefined) {

    var root = this,

        _invert = function(obj) {
            var result = {},
                key;
            for (key in obj) {
                result[obj[key]] = key;
            }
            return result;
        },

        _defer = root.process && root.process.nextTick ? function(callback) {
            root.process.nextTick(callback);
        } : function(callback) {
            setTimeout(callback, 0);
        },

        _idCounter = 0,

        _nativeToString = ({}).toString,
        _nativeSlide = ([]).slice,

        _slice = function(arr) {
            return _nativeSlide.call(arr);
        },

        _isArray = Array.isArray || function(obj) {
            return _nativeToString.call(obj) === '[object Array]';
        },

        _isNumber = function(obj) {
            return _nativeToString.call(obj) === '[object Number]';
        };

        /**
         * Status values, determines
         * what the promise's status is
         * @readonly
         * @enum {Number}
         * @alias _PROMISE_STATUS
         */
    var _PROMISE_STATUS = {
            idle:       0,
            progressed: 1,
            failed:     2,
            done:       3
        },
        /**
         * Call values, used to determine
         * what kind of functions to call
         * @readonly
         * @enum {Number}
         * @alias _PROMISE_CALL
         */
        _PROMISE_CALL = {
            done:     0,
            fail:     1,
            always:   2,
            progress: 3,
            pipe:     4
        },
        _PROMISE_CALL_NAME = _invert(_PROMISE_CALL);

    /**
     * A lightweight implementation of promises.
     * API based on {@link https://api.jquery.com/promise/ jQuery.promises}
     * @class Promise
     */
    var Promise = function(func) {
        var self = this;

        /**
         * @type {Id}
         * @private
         */
        self._id = ++_idCounter;

        /**
         * Registered functions organized by _PROMISE_CALL
         * @type {Object}
         * @private
         */
        self._calls = {};

        /**
         * Current status
         * @type {Number}
         * @private
         */
        self._status = _PROMISE_STATUS.idle;

        /**
         * Allow an ES6 style call
         * (only if the function is provided)
         */
        if (func) {
            func(self.resolve.bind(self), self.reject.bind(self));
        }
    };

    Promise.prototype = /** @lends Promise# */ {
        constructor: Promise,

        /**
         * Register a done call that is fired after a Promise is resolved
         * @param  {Function} func
         * @return {Promise}
         */
        done: function(func) { return this._pushCall(_PROMISE_CALL.done, func); },
        then: function(func) { return this._pushCall(_PROMISE_CALL.done, func); },
        /**
         * Register a fail call that is fired after a Promise is rejected
         * @param  {Function} func
         * @return {Promise}
         */
        fail: function(func) { return this._pushCall(_PROMISE_CALL.fail, func); },
        /**
         * Register a call that fires after done or fail
         * @param  {Function} func
         * @return {Promise}
         */
        always: function(func) { return this._pushCall(_PROMISE_CALL.always, func); },
        finally: function(func) { return this._pushCall(_PROMISE_CALL.always, func); },
        /**
         * Register a progress call that is fired after a Promise is notified
         * @param  {Function} func
         * @return {Promise}
         */
        progress: function(func) { return this._pushCall(_PROMISE_CALL.progress, func); },
        /**
         * Register a pipe call that is fired before done or fail and whose return value
         * is passed to the next pipe/done/fail call
         * @param  {Function} func
         * @return {Promise}
         */
        pipe: function(func) { return this._pushCall(_PROMISE_CALL.pipe, func); },

        /**
         * Pushes a function into a call array by type
         * @param  {_PROMISE_CALL} callType
         * @param  {Function} func
         * @return {Promise}
         * @private
         */
        _pushCall: function(callType, func) {
            var self = this,
                status = self._status;
            if (status !== _PROMISE_STATUS.idle) {
                if (
                    // done
                    (status === _PROMISE_STATUS.done   && callType === _PROMISE_CALL.done) ||
                    // fail
                    (status === _PROMISE_STATUS.failed && callType === _PROMISE_CALL.fail) ||
                    // always
                    ((status === _PROMISE_STATUS.done || status === _PROMISE_STATUS.failed) && callType === _PROMISE_CALL.always)
                ) {
                    _defer(function() { func.call(null, self._firedArgs); });
                    return self;
                }
            }

            self._getCalls(callType).push(func);
            return self;
        },

        /**
         * Notify the promise - calls any functions in
         * Promise.progress
         * @return {Promise}
         */
        notify: function() {
            var self = this;

            self._status = _PROMISE_STATUS.progressed;

            var args = self._runPipe(arguments);
            self._fire(_PROMISE_CALL.progress, args)._fire(_PROMISE_CALL.always, args);

            return self;
        },

        /**
         * Reject the promise - calls any functions in
         * Promise.fail, then calls any functions in
         * Promise.always
         * @return {Promise}
         */
        reject: function() {
            var self = this;

            // If we've already called failed or done, go no further
            if (self._status === _PROMISE_STATUS.failed || self._status === _PROMISE_STATUS.done) { return self; }

            self._status = _PROMISE_STATUS.failed;

            // Never run the pipe on fail. Simply fail.
            // Running the pipe after an unexpected failure may lead to
            // more failures
            self._fire(_PROMISE_CALL.fail, arguments)
                ._fire(_PROMISE_CALL.always, arguments);

            self._cleanup();

            return self;
        },

        /**
         * Resolve the promise - calls any functions in
         * Promise.done, then calls any functions in
         * Promise.always
         * @return {Promise}
         */
        resolve: function() {
            var self = this;

            // If we've already called failed or done, go no further
            if (self._status === _PROMISE_STATUS.failed || self._status === _PROMISE_STATUS.done) { return self; }

            self._status = _PROMISE_STATUS.done;

            var args = self._runPipe(arguments);
            self._fire(_PROMISE_CALL.done, args)
                ._fire(_PROMISE_CALL.always, args);

            self._cleanup();

            return self;
        },

        /**
         * Returns the status of the Promise
         * @return {Number} STATUS
         */
        status: function() {
            return this._status;
        },

        /**
         * Fires a _PROMISE_CALL type with the provided arguments
         * @param  {_PROMISE_CALL} callType
         * @param  {Array} args
         * @return {Promise}
         * @private
         */
        _fire: function(callType, args) {
            var self = this;

            self._firedArgs = args;

            var calls = self._getCalls(callType),
                idx = 0, length = calls.length;
            for (; idx < length; idx++) {
                calls[idx].apply(null, args);
            }
            return self;
        },

        /**
         * Runs the pipe, catching the return value
         * to pass to the next pipe. Returns the
         * arguments to used by the calling method
         * to proceed to call other methods (e.g. done/fail/always)
         * @param  {Array} args
         * @return {Array} args
         * @private
         */
        _runPipe: function(args) {
            var pipes = this._getCalls(_PROMISE_CALL.pipe),
                idx = 0, length = pipes.length, val;
            for (; idx < length; idx++) {
                val = pipes[idx].apply(null, args);
                if (val !== undefined) { args = [val]; }
            }

            return args;
        },

        /**
         * Lazy generate arrays based on type to
         * avoid creating disposable arrays for
         * methods that aren't going to be used/called
         * @param  {_PROMISE_CALL} type
         * @return {Array}
         * @private
         */
        _getCalls: function(type) {
            var self = this;
            return self._calls[_PROMISE_CALL_NAME[type]] || (self._calls[_PROMISE_CALL_NAME[type]] = []);
        },

        /**
         * Allows a promise to be called like a
         * Function.call() or Function.apply()
         *
         * Very useful for passing a promise as
         * a callback function to 3rd party code
         * (as long as the third party code doesn't
         * try to invoke the Promise directly)
         */
        call: function() {
            var self = this,
                args = _slice(arguments);
            args.splice(0, 1); // Throw away the context
            self.notify.apply(self, args);
        },
        apply: function(ctx, args) {
            var self = this;
            self.notify.apply(self, args);
        },

        /**
         * Cleanup references to functions stored in
         * arrays that are no longer able to be called
         * @private
         */
        _cleanup: function() {
            var self = this;
            self._getCalls(_PROMISE_CALL.done).length = 0;
            self._getCalls(_PROMISE_CALL.fail).length = 0;
            self._getCalls(_PROMISE_CALL.always).length = 0;
        },

        /**
         * Create a protected object that does not
         * allow promise resolution.
         * @return {Object}
         */
        promise: function() {
            var self = this;
            return {
                done:     self.done.bind(self),
                then:     self.then.bind(self),
                fail:     self.fail.bind(self),
                always:   self.always.bind(self),
                finally:  self.finally.bind(self),
                progress: self.progress.bind(self),
                pipe:     self.pipe.bind(self)
            };
        },

        /**
         * Debug string
         * @return {String}
         */
        toString: function() {
            var self = this;
            return 'promise-js - ' + [
                'id: '       + self._id,
                'status: '   + _invert(_PROMISE_STATUS)[self._status],
                'done: '     + self._getCalls(_PROMISE_CALL.done).length,
                'fail: '     + self._getCalls(_PROMISE_CALL.fail).length,
                'always: '   + self._getCalls(_PROMISE_CALL.always).length,
                'progress: ' + self._getCalls(_PROMISE_CALL.progress).length,
                'pipe: '     + self._getCalls(_PROMISE_CALL.pipe).length
            ].join(', ');
        }
    };

    /**
     * When to go with Promise. Used by calling `when()` and passing
     * promises to listen to. when can be chained with multiple calls
     * e.g. `when(p1, p2, p3).then(func).then(func).done(func).always(func);`
     * @function when
     * @param {...Promise} promises
     * @return {Promise} A new promise that resolves when all of the given <code>promises</code> resolve.
     */

    /**
     * The when object. It's not exposed to the user,
     * they only see a promise (with a .then() method),
     * but all the magic happens here
     */
    var When = function() {
        /**
         * Store our promise
         * @type {Promise}
         */
        // this._p;

        /**
         * Store the promises being listened to
         * @type {Array.<Promise>}
         */
        this._events = [];
    };

    When.prototype = {
        constructor: When,

        /**
         * Called by the public when function to initialize
         * the when object
         * @return {Promise}
         */
        init: function() {
            var self = this;

            self._events = _isArray(arguments[0]) ? arguments[0] : _slice(arguments);
            self._subscribe();

            var promise = new Promise();
            promise.then = function() { self.done.apply(self, arguments); };
            self._p = promise;
            return promise; // Return the promise so that it can be subscribed to
        },

        /**
         * Subscribe to the promises passed and react
         * when they fire events
         * @private
         */
        _subscribe: function() {
            var self = this,
                check = self._checkStatus.bind(self),
                fireProgress = self._fireProgress.bind(self),
                events = self._events,
                idx = events.length;
            while (idx--) {
                events[idx].done(check).fail(check).progress(fireProgress);
            }
        },

        /**
         * Check the status of all promises when
         * any one promise fires an event
         * @private
         */
        _checkStatus: function() {
            var self = this,
                events = self._events, evt,
                total = events.length,
                done = 0, failed = 0,
                idx = total;
            while (idx--) {
                evt = events[idx];
                // We're waiting for everything to complete
                // so if there's an item with no status, stop
                if (evt.status() === _PROMISE_STATUS.idle) { return; }
                if (evt.status() === _PROMISE_STATUS.done) { done += 1; continue; }
                if (evt.status() === _PROMISE_STATUS.failed) { failed += 1; continue; }
            }
            self._fire(total, done, failed, arguments);
        },

        /**
         * Based on the statuses of our promises, fire the
         * appropriate events
         * @param  {Number}    total  total number of promises
         * @param  {Number}    done   promises in a done state
         * @param  {Number}    failed promises in a failed state
         * @param  {Arguments} args   arguments to pass
         * @private
         */
        _fire: function(total, done, failed, args) {
            var promise = this._p; // Our promise

            // If everything completed, call done (this will call always)
            if (done === total) { return promise.resolve.apply(promise, args); }

            // If everything failed, call fail (this will call always)
            if (failed === total) { return promise.reject.apply(promise, args); }

            // If everything fired, but they're not all one thing, then just call always.
            // The only way to do that without exposing a public function in Promise is
            // to use the private _fire event
            if ((done + failed) === total) { return promise._fire(_PROMISE_CALL.always, args); }
        },

        /**
         * Handled separately from fire because we want to trigger
         * anytime any of the promises progress regardless of sate
         * @private
         */
        _fireProgress: function() {
            var promise = this._p;
            promise.notify.apply(promise, arguments);
        }
    };

    var api = function() {
        return new Promise();
    };
    api.when = function() {
        var w = new When();
        return w.init.apply(w, arguments);
    };

    return api;

});