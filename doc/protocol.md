
Protocol Documentation
======================

The protocol is a simple transport for other APIs. It's a simple wrapper over
some other protocols, like DBus, REST, and so on. At the present time this
is unstable, but will need to become stable in the near future.

Channels
--------

Each message is part of a channel, which has a id. This channel id
identifies the type of data in the message payload, the host where it is
headed to/from and things like the service or user credentials.

An empty/missing channel id represents a special channel called the control
channel. It contains command messages. These are described below. Initially
only the control channel exists. Additional channels are opened and closed
via command messages.

Channels operate across all participants, and they help a forwarding layer
like cockpit-ws to know where to send messages.

Framing
-------

The channel id is a UTF-8 valid string.  The channel id string comes first
in the message, then a new line, then payload.

For example if you had a payload of the string 'abc', and it was being
sent through the channel 'a5', that might look like:

    a5\nabc

When a message is sent over a stream transport that does not have distinct
messages (such as SSH or stdio), the message is also prefixed with a base 10
integer and new line, which represents the length of the following message.
The length must be a positive number in canonical form (ie: strictly greater
than zero, with no leading zeros).

An example. When going over a stream transport with a payload of the 3 byte
string 'abc', and a channel of 'a5', would have a message length of 6: 3 bytes of
payload, 2 bytes for the channel number, 1 for the new line. It would look like
this in a stream:

    6\na5\nabc

Control Messages
----------------

Control messages let the various components such as cockpit-web, cockpit-ws and
cockpit-bridge communicate about what's going on.

Control messages are always sent in the control channel. They always have an
empty channel. The payload of a control message is always a json
object. There is always a "command" field:

```
{
    "command": <command>,
    "channel": <channel>,
    ...
}
```

If a control message pertains to a specific channel it has a "channel" field
containing the id of the channel. It is invalid to have a present but empty
"channel" field.

Unknown control messages are ignored. Control messages that have a channel are
forwarded to the correct endpoint. Control messages without a channel are not
forwarded, but only travel a single hop.


Command: init
-------------

The "init" command is the first message sent over a new transport. It is
an error if any other message is received first. The transport is not considered
open until the "init" message has been received.

The following fields are defined:

 * "version": The version of the protocol. Currently 1, and stable.
 * "capabilities": Optional array of strings advertizing capabilities.
 * "channel-seed": A seed to be used when generating new channel ids.
 * "host": The host being communicated with.
 * "problem": A problem occurred during init.
 * "csrf-token": The web service will send a csrf-token for external channels.
 * "os-release": The bridge sends fields from /etc/os-release which identify the system.
 * "packages": The bridge sends a list of package names on the system.
 * "superuser": Instructs a bridge about whether and how to start a superuser bridge.

If a problem occurs that requires shutdown of a transport, then the "problem"
field can be set to indicate why the shutdown will be shortly occurring.

The "init" command message may be sent multiple times across an already open
transport, if certain parameters need to be renegotiated.

Command: open
-------------

The "open" command opens a new channel for payload.

The following fields are defined:

 * "binary": If present set to "raw"
 * "channel": A uniquely chosen channel id
 * "payload": A payload type, see below
 * "host": The destination host for the channel, defaults to "localhost"
 * "user": Optional alternate user for authenticating with host
 * "superuser": Optional. Use "require" to run as root, or "try" to attempt to run as root.
 * "group": An optional channel group
 * "capabilities": Optional, array of capability strings required from the bridge
 * "session": Optional, set to "private" or "shared". Defaults to "shared"
 * "flow-control": Optional boolean whether the channel should throttle itself via flow control.
 * "send-acks": Set to "bytes" to send "ack" messages after processing each data frame


If "binary" is set to "raw" then this channel transfers binary messages.

After the command is sent, then the channel is assumed to be open. No response
is sent. If for some reason the channel shouldn't or cannot be opened, then
the recipient will respond with a "close" message.

The channel id must not already be in use by another channel.

An example of an open:

```json
{
    "command": "open",
    "channel": "a4",
    "payload": "stream",
    "host": "localhost"
}
```

This message is sent to the cockpit-bridge.

The caller can control whether to open a new bridge session or not by setting
the "session" field to "private" or "shared". A "private" session will always
start another bridge just for this channel. If this option is not specified
then typically the channel will share an already existing session. There are
certain heuristics for compatibility, where it defaults to private.

The open fields are also used with external channels. External channels are
channels that have their payload sent via a separate HTTP request or another
WebSocket. In this case the "channel" field must not be present, and an
"external" field may be present with the following arguments:

 * "content-disposition": a Content-Disposition header for GET responses
 * "content-type": a Content-Type header for GET responses
 * "protocols": an array of possible protocols for a WebSocket

Channel "group" fields can be used to group channels into groups. You should
prefix your groups with a reverse domain name so they don't conflict with
other or Cockpit's group names. Group names without any punctuation are
reserved.

One such special group name is "default", which contains all channels which
were opened without specifying a group.

The "flow-control" option controls whether a channel should attempt to throttle
itself via flow control when sending or receiving large amounts of data. The
current default (when this option is not provided) is to not do flow control.
However, this default will likely change in the future.  This only impacts data
sent by the bridge to the browser.

If "send-acks" is set to "bytes" then the bridge will send acknowledgement
messages detailing the number of payload bytes that it has received and
processed.  This mechanism is provided for senders (ie: in the browser) who
wish to throttle the data that they're sending to the bridge.

**Host values**

Because the host parameter is how cockpit maps url requests to the correct bridge,
cockpit may need to additional information to route the message correctly.
For example you want to connect to a container `my-container` running
on "my.host".

To allow this the host parameter can encode a key/value pair that will
be expanded in the open command json. The format is host+key+value. For example

```json
{
    "command": "open",
    "channel": "a4",
    "payload": "stream",
    "host": "my.host+container+my-container"
}
```

will be expanded to

```json
{
    "command": "open",
    "channel": "a4",
    "payload": "stream",
    "host": "my.host",
    "host-container": "my-container",
    "host": "my.host"
}
```

Command: close
--------------

The "close" command closes a channel.

The following fields are defined:

 * "channel": The id of the channel to close
 * "problem": A short problem code for closure, or not present for a normal close

The channel id must be set.  An example of a close:

```json
{
    "command": "close",
    "channel" : "5x",
    "problem": "access-denied"
}
```

Any protocol participant can send this message. The cockpit-bridge and cockpit-ws
backends will send this message when a channel closes whether because of an
error or a normal closure. The frontend cockpit-web will send this when it
wants to close a channel normally. Once either end has sent this message the
channel is considered closed.

See below for a list of problem codes.

When a channel closing is the result of a ssh transport closing cockpit-ws
reports on the authentication methods used while attempting to authenticate
by adding a "auth-method-results" object to the close object. This is mainly
useful to provide helpful error messages and suggestions to users.

The "auth-method-results" object contains a key for each method that cockpit-ws
is able to attempt authentication with as well as the result of the attempt.
For example:

```json
{
    "password": "denied"
}
```

This possible "result" values are:

 * "no-server-support": The target server does not support this method.
 * "not-provided": cockpit-ws doesn't have a credential to try so this method was skipped.
 * "succeeded": Authentication with this method was successful.
 * "denied": Authentication with this method was denied.
 * "partial": The server wants more authentication.
 * "error": Unexpected error occurred when using this method.
 * "not-tried": This methods was not tried, usually due to an earlier method succeeding.

Other fields may be present in a close message.

Command: ready
--------------

The "ready" command indicates that the channel implementation (usually
the bridge) is in a ready and settled state. It is not normally necessary to
listen to this control message, since it is possible to start sending payload
over a channel immediately after the open message has been sent.

The following fields are defined:

 * "channel": The id of the channel

Other fields may be present in a ready message.

Command: done
-------------

The "done" command indicates that no more messages will be sent on the channel
in the same direction as the "done" was sent.

The following fields are defined:

 * "channel": The id of the channel

Either or both endpoints of a channel can send this message. It may only be
sent once.

After it is sent no more messages may be sent in that direction. It is an error
to send further messages, or send another "done" message.


Command: options
----------------

The "options" command sends further channel options on the fly. The contents of
the message depends on the channel payload.

The following fields are defined:

 * "channel": The id of the channel


Command: ping
-------------

The "ping" command is simply a keep alive.

No additional fields are defined, but any are allowed. If a "channel"
is set this "ping" will be forwarded. Otherwise it be limited to a single hop.

An example of a ping:

```json
{
"command": "ping"
}
```

Any protocol participant can send a "ping". It is responded to by sending
a "pong" with identical options as a reply. If a "ping" is sent with a
"channel" field set to a channel that is not currently open, the "ping"
will be ignored as expected, and no "pong" will be sent.

Command: authorize
------------------

The "authorize" command is for communication of authentication and
authorization challenges and responses between cockpit-bridge and
cockpit-ws. Despite the name this is also used for authentication.

For challenge/response authentication, the following fields are defined:

 * "cookie": a unique string sent with a challenge that must be
   present in the corresponding response.
 * "challenge": a challenge string present in messages from a bridge
   to cockpit-ws
 * "response": a response string present in messages from cockpit-ws
   to a bridge

Example authorize challenge and response messages:

```json
{
    "command": "authorize",
    "cookie": "555",
    "challenge": "crypt1:74657374:$6$2rcph,noe92ot..."
}
```

```json
{
    "command": "authorize",
    "cookie": "555",
    "response": "crypt1:$6$r0oetn2039ntoen..."
}
```

Authorize messages are used during authentication by authentication
commands like `cockpit-session` to obtain the users credentials
from cockpit-ws. An authentication command can send a authorize message
with a response but no cookie. For example

```json
{
    "command": "authorize",
    "response": "Basic ..."
}
```

In that case cockpit-ws will store the response and use it in a reply
to a subsequent challenge.

For credential cache authorization, the following fields are defined:

 * "credential": Empty or "password"

When set to "password" then a "password" field should also be present
which represents a new password to cache, which replaces any current
passwords. If no password field is present then the passwords are cleared.


Command: kill
-------------

The "kill" command terminates a whole set of channels. It is sent by the frontend
and processed by cockpit-ws.

The following fields are defined:

 * "host": optional string kills channels with the given host
 * "group": optional string to select only channels opened with the given "group"

If no fields are specified then all channels are terminated.

Command: logout
---------------

The "logout" command is sent by the shell to cockpit-ws. It
disconnects the user.

In older versions, the "logout" command was broadcast to all bridges
and used to terminate privileged ones.  Privileged bridges are now
terminated by closing their transport.

Command: hint
-------------

The "hint" command provides hints to other components about the state of things
or what's going to happen next. The remainder of the fields are extensible.


Payload: null
-------------

A channel opened with this payload type will never send data, and will
ignore all data it receives.

Payload: echo
-------------

A channel opened with this payload type will send back all data that
it receives. It sends an "done" when it receives one.


Payload: dbus-json3
-------------------

DBus messages are encoded in JSON payloads by cockpit-web, and decoded in
cockpit-bridge. The 'dbus-json1' and 'dbus-json2' protocols are no
longer supported.

Additional "open" command options are needed to open a channel of this
type:

 * "bus": The DBus bus to connect to either "session", "system" or "none".
   Defaults to "system" if not present. If set to "none" you must also
   provide the address parameter.
 * "name": A service name of the DBus service to communicate with by default.
   Always omit this field if "bus" is "none". If omitted and "bus" is not
   "none" then a "name" field must be specified explicitly on other messages.
 * "address": A dbus supported address to connect to. This option is only
   used when bus is set to "none". Accepts any valid DBus address or
   "internal" to communicate with the internal bridge DBus connection.

The DBus bus name is started on the bus if it is not already running. If it
could not be started the channel is closed with a "not-found". If the DBus
connection closes, the channel closes with "disconnected".

DBus messages are encoded as JSON objects. If an unrecognized JSON object
is received, then the channel is closed with a "protocol-error".

Method calls are a JSON object with a "call" field, whose value is an array,
with parameters in this order: path, interface, method, in arguments.

```json
{
    "call": [ "/path", "org.Interface", "Method", [ "arg0", 1, "arg2" ] ],
    "id": "cookie"
}
```

All the various parameters must be valid for their use. arguments may be
null if no DBus method call body is expected. If a "type" field is specified
then it is expected to be the DBus method type signature (no tuple). If a
"flags" field is a string, then this includes message flags. The default flags
option has the "i" flag set:

 * "i": Allow interactive authentication.

If no "name" field was specified in the "open" call, indicating which DBus
service to talk to, then one must be specified here along with the "call".

If a DBus method call fails an "error" message will be sent back. An error
will also be sent back in parameters or arguments in the "call" message are
invalid.

An optional "id" field indicates that a response is desired, which will be
sent back in a "reply" or "error" message with the same "id" field.

If an interface has been exported, then the bridge will send "call" messages
in its direction for calls received for on that interface.

Method reply messages are JSON objects with a "reply" field whose value is
an array, the array contains another array of out arguments, or null if
the DBus reply had no body.

```json
{
    "reply": [ [ "arg0", 1, 2 ] ],
    "id": "cookie"
}
```

If the call had a "type" field, then the reply will have one too containing
the DBus type signature of the arguments. If a "flags" field was present on
the call, then "flags" will also be present on the reply. Valid out flags
are:

 * `>`: Big endian message
 * `<`: Little endian message

An error message is JSON object with an "error" field whose value is an
array. The array contains: error name, error arguments

```json
{
    "error": [ "org.Error", [ "Usually a message" ] ],
    "id": "cookie"
}
```

To receive signals you must subscribe to them. This is done by sending a
"add-match" message. It contains various fields to match on. If a field
is missing then it is treated as a wildcard.

"path" limits the signals to those sent by that DBus object path, it must
be a valid object path according to the specification. "path_namespace"
limits signals to the subtree of DBus object paths. It must be a valid
object path according to the specification, and may not be specified
together with "path".

"interface" limits the signals to those sent on the given DBus interface,
and must be a valid interface name. "member" limits the signal to those
of that signal name. "arg0" limits the signals to those that have the
given string as their first argument. If any of the values are not
valid according to the dbus specification, the channel will close with
a "protocol-error".

```json
{
    "add-match": {
        "name": "org.the.Name",
        "path": "/the/path",
        "interface": "org.Interface",
        "member": "SignalName",
        "arg0": "first argument"
    }
}
```

If the "name" field is omitted, it will be populated from the "open" message.
If no "name" was specified in the "open" message, then DBus messages from any
bus name will be matched.

To unsubscribe from DBus signals, use the "remove-match" message. If a
match was added more than once, it must be removed the same number of
times before the signals are actually unsubscribed.

The form of "remove-match" is identical to "add-match".

```json
{
    "remove-match": {
        "name": "org.the.Name",
        "path": "/the/path",
        "interface": "org.Interface",
        "member": "SignalName",
        "arg0": "first argument"
    }
}
```

Signals are sent in JSON objects that have a "signal" field, which is an
array of parameters: path, interface, signal name, and arguments. arguments
may be null if the DBus signal had no body.

```json
{
    "signal": [ "/the/path", "org.Interface", "SignalName", [ "arg0", 1, 2 ] ]
}
```

If a signal message is sent to the bridge, the signal will be emitted.
In addition a "destination" field may be present to indicate whether
the signal should be broadcast or not.

```json
{
    "signal": [ "/the/path", "org.Interface", "SignalName", [ "arg0", 1, 2 ] ]
}
```

If the bus name of the sender of the signal does not match the "name" field of
the "open" message, then a "name" field will be included with the "signal" message.

Properties can be watched with the "watch" request. Either a "path" or
"path_namespace" can be watched. Property changes are listened for with
DBus PropertiesChanged signals.  If a "path_namespace" is watched and
path is a DBus ObjectManager, then it is used to watch for new DBus
interfaces, otherwise DBus introspection is used. The "id" field is
optional, if present a "reply" will be sent with this same "id" when
the watch has sent "notify" messages about the things being watched.

```json
{
    "watch": {
        "name": "org.the.Name",
        "path": "/the/path/to/watch",
        "interface": "org.Interface"
    },
    "id": 5
}
```

To remove a watch, pass the identical parameters with an "unwatch"
request.

```json
{
    "unwatch": {
        "path": "/the/path/to/watch"
    }
}
```

If the "name" field is omitted, it will be populated from the "open" message.
Either a "name" field must be specified here or in the "open" message.

Property changes will be sent using a "notify" message. This includes
addition of interfaces without properties, which will be an empty
interface object, or interfaces removed, which will be null. Only the
changes since the last "notify" message will be sent.

```json
{
    "notify": {
        "/a/path": {
            "org.Interface1": {
                "Prop1": "x",
                "Prop2": 1
            },
            "org.Interface2": { }
        },
        "/another/path": {
            "org.Removed": null
        }
    }
}
```

If the bus name of the sender of the signal does not match the "name" field of
the "open" message, then a "name" field will be included with the "notify" message.

Interface introspection data is sent using "meta" message. Before the
first time an interface is sent using a "notify" message, a "meta"
will be sent with that interface introspection info. Additional fields
will be defined here, but this is it for now.

```json
{
    "meta": {
        "org.Interface": {
            "methods": {
                "Method1": { },
                "Method2": { }
            },
            "properties": {
                "Prop1": { "flags": "rw" },
                "Prop2": { "flags": "r" }
            }
        }
    }
}
```

If the bus name of the sender of the signal does not match the "name" field of
the "open" message, then a "name" field will be included with the "meta" message.
Such meta information can also be sent to the bridge, in order to populate the
cache of introspection data for the channel.

When the owner of the DBus "name" (specified in the open message) changes an "owner"
message is sent. The owner value will be the id of the owner or null if the name
is unowned.

```json
{
    "owner": "1:"
}
```

A "publish" message can be used to export DBus interfaces on the bus. The bridge
will then send "call" messages back to the frontend for each method invocation
on the published interface and object path. The interface must first be described
with DBus meta information. If a cookie is specified then a reply will be sent
when the interface is published. If the interface is already published at the given
path, it will be replaced.

```json
{
    "publish": [ "/a/path", "org.Interface" ],
    "id": "cookie"
}
```

An "unpublish" message will unexport a DBus interface on the bus. It is not an
error if no such interface has been published.

```json
{
    "unpublish": [ "/a/path", "org.Interface" ]
}
```

DBus types are encoded in various places in these messages, such as the
arguments. These types are encoded as follows:

 * byte, int16, uint16, int32, uint32, int64, uint64, double: encoded
   as a JSON number
 * boolean: encoded as a JSON boolean
 * string, object-path, signature: encoded as JSON strings
 * array of bytes: encoded as a base64 string
 * other arrays, struct/tuple: encoded as JSON arrays
 * dict: encoded as a JSON object, if the dict has string keys then those
   are used as property names directly, otherwise the keys are JSON encoded and
   the resulting string is used as a property name.
 * variant: encoded as a JSON object with a "v" field containing a value
   and a "t" field containing a DBus type signature.

```json
{
    "v": "value",
    "t": "s"
}
```

Payload: http-stream2
---------------------

This channel represents a single HTTP request and response. The request
HTTP headers are sent in the "open" message, and response headers are
returned in a "response" control message.

The remaining messages make up the HTTP request and response bodies.
When the channel is in text mode, the response body is automatically
coerced to UTF-8.

The following HTTP methods are not permitted:

 * 'CONNECT'

The following headers are not permitted on requests, some of these
are added automatically as appropriate, and others are stripped from
the response, in particular 'Content-Length':

 * 'Accept-Charset'
 * 'Accept-Ranges'
 * 'Connection'
 * 'Content-Length'
 * 'Content-MD5'
 * 'Content-Range'
 * 'Range'
 * 'TE'
 * 'Trailer'
 * 'Transfer-Encoding'
 * 'Upgrade'

The following are not accepted on non-binary channels:

 * 'Accept-Encoding'
 * 'Content-Encoding'

Additional "open" command options are needed to open a channel of this
payload type:

 * "unix": Open a channel with the given unix socket.
 * "port": Open a channel with the given TCP port on localhost.
 * "address": Open a channel that communicates with the given
   address instead of localhost. This can be an IP address or a valid
   host name. To use this option you must also specify a port.
   This option should be used to communicate with external
   apis and not as a synonym for the host parameter.
 * "method": "GET", "POST", or other valid HTTP method

You may also specify these options:

 * "headers": JSON object with additional request headers
 * "tls": Set to a object to use an https connection.

The TLS object can have the following options:

 * "certificate": The client certificate to use, represented as an
   object described below.
 * "key": The client key to use, described below.
 * "authority": Certificate authority(s) to expect as signers of peer.
 * "validate": Validate the peer's certificate.

The "certificate", "key" and "authority" are objects with either of
the following fields:

 * "file": String with a file name
 * "data": String with PEM encoded data

Any data to be sent should be sent via the channel, and then the channel
should be closed without a problem.

Payload: websocket-stream1
--------------------------

This channel payload implements a WebSocket client. The data in the
channel is the message frames.

Most of same options for http-stream2 apply here.

The response headers are send back in a "response" control message.

Payload: stream
---------------

Raw data is sent back and forth to a socket. See cockpitstream.c. The
boundaries of the messages are arbitrary, and depend on how the kernel
and socket buffer things.

If the channel is not binary, then non-UTF-8 data is forced into UTF-8
with a replacement character.

Additional "open" command options should be specified with a channel of
this payload type:

 * "unix": Open a channel with the given unix socket.
 * "port": Open a channel with the given TCP port on localhost.
 * "address": Open a channel that communicates with the given
    address instead of localhost. This can be an IP address or a valid
    host name. To use this option you must also specify a port.
 * "batch": Batches data coming from the stream in blocks of at least this
   size. This is not a guarantee. After a short timeout the data will be
   sent even if the data doesn't match the batch size. Defaults to zero.
 * "latency": The timeout for flushing any cached data in milliseconds.
 * "spawn": Spawn a process and connect standard input and standard output
   to the channel. Should be an array of strings which is the process
   file path and arguments.

You can't specify both "unix" and "spawn" together. When "spawn" is set the
following options can be specified:

 * "directory": The directory to spawn the process in.
 * "err": If "spawn" is set, and "err" is set to "out", then stderr
   is included in the payload data. If "err" is set to "ignore" then, the
   stderr output will be discarded. If "err" is set to "message" then it will
   be included in the close message. If "pty" is set then stderr is always
   included.
 * "environ": This is a list of additional environment variables for the new
   spawned process. The variables are in the form of "NAME=VALUE". The default
   environment is inherited from cockpit-bridge.
 * "pty": Execute the command as a terminal pty.
 * "window": An object containing "rows" and "cols" properties, which set the
   size of the terminal window. Values must be integers between 0 and 0xffff.
   This option is only valid if "pty" is true.

For type "spawn", the `ready` message contains a "pid" field with the spawned
process ID.

If an "done" is sent to the bridge on this channel, then the socket and/or pipe
input is shutdown. The channel will send an "done" when the output of the socket
or pipe is done.

If "spawn" is set and the channel is closed with a "problem" code, then the
process will be sent a SIGTERM signal.

Additionally, a "options" control message may be sent in this channel
to change the "batch", "latency", and "window" options.

Payload: packet
---------------

Raw data is sent back and forth to as messages to a socket. The message
boundaries correspond exactly to the messages sent over the socket.

If the channel is not binary, then non-UTF-8 data is forced into UTF-8
with a replacement character.

Additional "open" command options should be specified with a channel of
this payload type:

 * "unix": Open a channel with the given unix socket.
 * "max-size": The maximum possible size of a message. Default is 64K
   Supports up to 128K. Messages larger than this will be truncated.

If an "done" is sent to the bridge on this channel, then the socket
input is shutdown. The channel will send an "done" when the output of the socket
or pipe is done.

Additionally, a "options" control message may be sent in this channel
to change the "max-size" options.

Payload: fsinfo
----------------

This channel is used to report information about a given path, and the file or
a directory which may reside there, including the possibility of updates.  In
the case of directories, information can also be reported about the (directly)
contained entries.

Additional "open" command options should be specified with a channel of
this payload type:

 * `path` (mandatory): a string, an absolute path name.  If this ends with `/`
   then the path must refer to a directory.
 * `attrs` (mandatory): a list of strings, the requested attributes to be
   reported for the file at `path`, and (optionally) its sub-items.  See below
   for the possibilities.
 * `fnmatch`: (optional, default ''): if non-empty, this is a [`fnmatch`-style
   pattern](https://docs.python.org/3/library/fnmatch.html).  In case `path`
   refers to a readable directory, an `entries` attribute will be reported
   (described below).  Use `*` to report all files.  Can also be used to
   implement search (`searc*`) or hide temporary files (`[!.]*`).
 * `watch` (optional, default: false): if the channel should watch for changes
 * `follow` (default: true): if the trailing component of `path` is a symbolic
   link, whether we should follow it.  `follow: false` mode is not supported
   for `watch` (but is also mostly unnecessary).

A channel is created with an associated absolute pathname (`path`).  A path is
a string that you pass to the `open()` syscall.  The object returned by that
call is described by the (JSON Document) value of the channel.

Strictly speaking, the path is specified to the channel as a unicode string,
but paths on the filesystem are binary strings.  This mapping is handled using
the usual Python convention: filenames are stored in utf8 and encoded and
decoded with `errors='surrogateescape'`, which allows for handling of filenames
which are not utf8.

Conceptually, the channel represents the value of a JSON object describing what
is found at the path, or the reason for an error.  Each message on the channel
is a JSON Merge Patch ([RFC
7396](https://datatracker.ietf.org/doc/html/rfc7396)) which updates or replaces
this object.

The top-level keys in the object are:

 - `info`: the info about the reported path (described below)
 - `error`: an object with information about why `info` can't be reported.
   This is currently basically an errno formatted in several possible ways:
    - `problem`: a Cockpit "problem" code type of string like `not-found` or
      `not-directory`
    - `message`: the result of strerror().  Currently English, hopefully
      translated at some point
    - `errno`: the symbolic `errno` name like `ENOENT` or `ENOTDIR`
 - `partial`: `true` if the data is in a "partial" state.  This is used when
   sending updates in multiple pieces.

The value of the `info` attribute is a JSON object describing the attributes of
the file.  Any attribute which cannot be read (eg: due to permissions problems)
is simply not reported.

 * `type`: a string: `reg`, `dir`, `lnk`, `chr`, `blk`, `fifo`, or `sock`
 * `mode`: an integer representing the "file permission" bits
   (`S_IMODE(st_mode)`).  As per JSON, this is transmitted as a decimal value,
   but it is meant to be interpreted in octal, in the usual way.
 * `uid`: an integer, the uid of the file owner (`st_uid`)
 * `user`: a string, or an integer if the lookup failed
 * `gid`: an integer, the gid of the file group (`st_gid`)
 * `group`: a string, or an integer if the lookup failed
 * `size`: an integer, the (apparent) size of the file (`st_size`)
 * `mtime`: a float, the mtime of the file (`st_mtim`)
 * `tag`: a value type: the current 'transaction tag' of the file, with the
   same meaning as elsewhere in this document.  Ideally: this changes if the
   content of the file changes.  This is the same as the tag used in `fsread1`
   and `fsreplace1`.
 * `entries`: for directories: the contents of the directory (see below)
 * `target`: for symbolic links: the target of the link (a string)
 * `targets`: for directories: extra information about symlink targets for
   symlinks found in the directory (see below)

The `entries` attribute is reported iff `fnmatch` is non-empty, and `path`
refers to a readable directory.  It is an object where each key is the name of
a file in the directory, and each value is an object describing that file,
using the same attributes as above.  `entries` is not reported on entries (ie:
no recursive listing).  Listing `entries` in `attrs` is equivalent to
`fnmatch='*'`.

The `targets` attribute is reported iff `targets` is listed in `attrs`.  It
contains information that was true at some point in time about the targets of
symbolic links that were found in the current directory.  An entry is added
here only in case the entry wouldn't be found in the main `entries` dictionary.
For example, if `path` is `/usr/lib` and `fnmatch` is `*.so` and the directory
contains the links `a.so → a-impl.so`, `b.so → b.so.0` and `c.so -> ../x/c.so`
then the `targets` dictionary would include `b.so.0` (which isn't reported in
entries because it doesn't match `fnmatch`) and `../x/c.so` (which isn't
reported because it's in a different directory).  Monitoring these entries for
changes would be expensive, so it's simply not done.  Clients are expected to
use this information to flesh out details about directory entries, answering
questions like "`/bin` links to `usr/bin`, but what type of file is that?".
`targets` is incompatible with `follow: false`.

If the provided `path` is a symbolic link, it is followed, unless
`follow: false` is specified.  If symbolic links are present in the directory,
they are always reported directly (ie: not followed).  `follow: false` is not
supported in combination with `watch: true` but you probably don't need it:
watch mode doesn't only watch the final path component, but all components
leading up to it, including any symlink that have been followed.  That means
that you can watch `/etc/localtime` and find out about if the link changed, or
if the contents of the file itself changed, or was deleted or replaced, or also
if `/usr`, `/etc`, or any other directories or intermediate links were changed,
deleted, or moved out of the way.

The life-cycle of the channel works like this:

 - When opening the channel, `ready` is always immediately sent.

 - One or more patches are sent to modify the initial value of the channel
   (`null`).  The "initial state" is reached when the value is a object
   which does not have the `partial` attribute set on it.

 - If `watch` mode is false then `done` is sent immediately, and the channel is
   closed.

 - Otherwise (`watch: true`), the channel remains open.  When any changes are
   detected, they are sent as updates to the value of the channel.  This may
   involve transitions between reporting `info` and reporting `problem`.

 - The channel will stay open until the client closes it.

Payload: fsread1
----------------

Returns the contents of a file and its current 'transaction tag'.

The following options can be specified in the "open" control message:

 * "path": The path name of the file to read.
 * "max_read_size": option to limit the amount of data that is read.  If the
   file is larger than the given number of bytes, no data is read and the
   channel is closed with problem code "too-large".  The default limit is 16
   MiB.  The limit can be completely removed by setting it to -1.

The ready message contains a "size-hint" when the channel is opened
with the "binary" option set to "raw".

The channel will return the content of the file in one or more
messages.  As with "stream", the boundaries of the messages are
arbitrary.

If the file is modified while you are reading it, the channel is
closed with a "change-conflict" problem code.  If the file is
atomically replaced as with 'rename' when you are reading it, this is
not considered an error and you will get the old content with a
correct tag.

When all content has been sent or an error has occurred, the channel
will be closed.  In addition to the usual "problem" field, the "close"
control message sent by the server might have the following additional
fields:

 * "message": A string in the current locale describing the error.

 * "tag": The transaction tag for the returned file content.  The tag
   for a non-existing file is "-".

It is not permitted to send data in an fsread1 channel. This channel
sends a "done" when all file data was sent.

Payload: fsreplace1
-----------------

Replace the content of a file.

The following options can be specified in the "open" control message:

 * "path": The path name of the file to replace.

 * "size": The expected size of the file content.  If set, the file is
   allocated immediately, and the channel "open" request will fail if
   insufficient space is available.  If this option is set, it is not
   possible to delete the file (ie: sending immediate EOF will result in
   a 0 byte file) This option should always be provided if possible, to
   avoid fragmentation, but is particularly important for large files.

 * "tag": The expected transaction tag of the file.  When the actual
   transaction tag of the file is different, the write will fail.  If
   you don't set this field, the actual tag will not be checked.  To
   express that you expect the file to not exist, use "-" as the tag.

* "attrs": a JSON object containing optional file attributes to set:
  - `user`: a string, or an integer, the uid of the file owner (`st_uid`).
    If set `group` also has to be set.
  - `group`: a string, or an integer, the gid of the file group (`st_gid`)
    If set `user` also has to be set.
  - `mode`:  an integer, usually expressed in octal, but in json it is the
    equivalent value in decimal.

You should write the new content to the channel as one or more
messages.  To indicate the end of the content, send a "done" message.

If you don't send any content messages before sending "done", and no
"size" was given, the file will be removed.  To create an empty file,
send at least one content message of length zero, or set the "size" to
0.

If "size" is given, and less data is actually sent, then the file will
be truncated down to the size of the data that was actually sent. If
more data is sent, the file will grow (subject to additional
fragmentation and potential ENOSPC errors).

When the file does not have the expected tag, the channel will be
closed with a "change-conflict" problem code.

The new content will be written to a temporary file and the old
content will be replaced with a "rename" syscall when the channel is
closed without problem code.  If the channel is closed with a problem
code (by either client or server), the file will be left untouched.

If `tag` is given and no equivalent `attrs`, file owner, mode and SELinux
context are preserved (copied from the original file). Other attributes (like
ACLs) are never copied.

In addition to the usual "problem" field, the "close" control message
sent by the server might have the following additional fields:

 * "message": A string in the current locale describing the error.

 * "tag": The transaction tag of the new content.

No payload messages will be sent by this channel.

Payload: metrics1
-----------------

With this payload type, you can monitor a large number of metrics,
such as all of the metrics exposed by PCP, the Performance Copilot.

In addition to monitoring live values of the metrics, you can also
access archives of previously recorded values.

You specify which metrics to monitor in the options of the "open"
command for a new channel.

One of the options is the "source" of the metrics.  Many details of
how to specify metrics and how the channel will work in detail depend
on the type of the source, and are explained in specific sections
below.

The channel guarantees that each sample returned by it contains values
for all requested metrics.

The general open options are:

 * "source" (string): The source of the metrics:

   * "direct": PCP metrics from plugins that are loaded into the
     Cockpit bridge directly.  Use this when in doubt.

   * "pmcd": PCP metrics from the local PCP daemon.

   * A string starting with "/": PCP metrics from one or more
     archives.

     The string is either the name of an archive, or the name of a
     directory.  When it refers to a directory, the bridge will find
     all archives in that directory and merge them.  The archives must
     not overlap in time.

   * "pcp-archive": PCP metrics from the default pmlogger archive.

     This is the same as using the name of the default pmlogger
     archive directory directly, but you don't have to know where it
     is.

 * "metrics" (array): Descriptions of the metrics to use.  See below.

 * "instances" (array of strings, optional): When specified, only the
   listed instances are included in the reported samples.

 * "omit-instances" (array of strings, optional): When specified, the
   listed instances are omitted from the reported samples.  Only one
   of "instances" and "omit-instances" can be specified.

 * "interval" (number, optional): The sample interval in milliseconds.
   Defaults to 1000.

 * "timestamp" (number, optional): The desired time of the first
   sample.  This is only used when accessing archives of samples.

   This is either the number of milliseconds since the epoch, or (when
   negative) the number of milliseconds in the past.

   The first sample will be from a time not earlier than this
   timestamp, but it might be from a much later time.

 * "limit" (number, optional): The number of samples to return.  This
   is only used when accessing an archive.

   When no "limit" is specified, all samples until the end of the
   archive are delivered.

You specify the desired metrics as an array of objects, where each
object describes one metric.  For example:

```json
[
    {
        "name": "kernel.all.cpu.user",
        "units": "millisec",
        "derive": "rate"
    },
    ...
]
```

A metric description can contain the following fields:

 * "name" (string): The name of the metric.  Available metrics depend
   on the source.

 * "units" (string, optional): The units that values for this metric
   should be delivered in.  If the given metric can not be converted
   into these units, the channel is closed.  The format of the string
   depends on the source.

 * "derive" (string, optional): Optional computation.  Possible values
   are "delta" and "rate".  For "delta", the channel delivers the
   difference between the current and the previous value for a metric.
   For "rate", the channel delivers the change per millisecond of the
   metric.

   For both "delta" and "rate", the value for a metric will be "false"
   if there is no previous value to do the computation with.

Once the channel is open, it will send messages encoded as JSON.  It
will send two types of message: 'meta' messages that describe the
metrics, and 'data' messages with the actual samples.

A 'meta' message applies to all following 'data' messages until the
next 'meta' message.  The first message in a channel will always be a
'meta' message.

The 'meta' messages are JSON objects; the 'data' messages are JSON
arrays.

The 'meta' messages have at least the following fields:

 * "metrics" (array): This field provides information about the
   requested metrics.  The array has one object for each metric, in
   the same order as the "metrics" option used when opening the
   channel.

   For each metric, the corresponding object contains at least the
   following field:

   * "instances" (array of strings, optional): This field lists the
      instances for instanced metrics.  This field is not present for
      non-instanced metrics.

   * "units" (string): The units of the values for this metric.

   * "derive" (string): The post-processing mode, as specified in the
     "open" message.

 * "timestamp" (number): The point in time of the next 'data' message,
   in milliseconds since the epoch.

 * "interval" (number): The time interval between subsequent points in
   time in the 'data' messages, in milliseconds.

Depending on the source, more fields might be present in a 'meta'
message, and more fields might be present in the objects of the
"metrics" field.

The 'data' messages are nested arrays in this shape:

```
    [  // first point in time
       [
          // first metric (instanced, with two instances)
          [
             // first instance
             1234,
             // second instance
             5678
          ],
          // second metric (not instanced)
          789,
          // third metric
          543
       ],
       // next point in time
       [
          // same shape again as for the first point in time
       ]
    ]
```

Thus, a 'data' message contains data for one or more points in time
where samples have been taken.  A point in time is always one
`interval` later than the previous point in time, even when they are
reported in the same 'data' message.

For real time monitoring, you will generally only receive one point in
time per 'data' message, but when accessing archived data, the channel
might report multiple points in time in one message, to improve
efficiency.

For each point in time, there is an array with samples for each
metric, in the same order as the `metrics` option used when opening
the channel.

For non-instanced metrics, the array contains the value of the metric.
For instanced metrics, the array contains another array with samples
for each instance, in the same order as reported in the `instances`
field of the most recent 'meta' message.

In order to gain efficiency, 'data' messages are usually compressed.
This is done by only transmitting the differences from one point in
time to the next.

If a value for a metric or a instance is the same as at the previous
point in time, the channel transmits a `null` value instead.
Additionally, `null` values at the end of an array are suppressed by
transmitting a shorter array.

For example, say the samples for three points in time are

    1: [ 21354, [ 5,  5, 5 ], 100 ]
    2: [ 21354, [ 5, 15, 5 ], 100 ]
    3: [ 21354, [ 5, 15, 5 ], 100 ]

then the channel will send these array instead:

    1: [ 21354, [    5,  5, 5 ], 100 ]
    2: [  null, [ null, 15 ] ]
    3: [  null, [ ] ]

This compression only happens when the last and current value belong
to the same instance of the same metric.  Thus, the client does not
need to track layout changes when decompressing data messages.

Instead of a number of `null`, a data message can also contain
`false`.  This indicates an error of some kind, or an unavailable
value.

**PCP metric source**

Cou can use "pminfo -L" to get a list of available PCP metric names
for a "direct" source, for example.  If no metric of this name exists,
the channel is closed without delivering any message.

The format of the "units" member is the same as the one used by
"pminfo -d".

The metric information objects in the 'meta' messages for PCP sources
also contain these fields:

 * `semantics` (string): The semantics of this metric, one of
   `counter`, `instant`, or `discrete`.

Only numeric metrics are currently supported.  Non-numeric metrics
have all their samples set to `false`.

Problem codes
-------------

These are problem codes for errors that cockpit-web responds to. They should
be self explanatory. It's totally not interesting to arbitrarily invent new
codes. Instead the web needs to be ready to react to these problems. When in
doubt use `internal-error`.

 * `internal-error`
 * `no-cockpit`
 * `unsupported-shell`
 * `no-session`
 * `access-denied`
 * `authentication-failed`
 * `not-found`
 * `terminated`
 * `timeout`
 * `unknown-hostkey`
 * `no-forwarding`
