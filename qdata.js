// QData <https://github.com/jshq/qdata>
(function(qclass, $export, $as) {
"use strict";

// ============================================================================
// [QData]
// ============================================================================

// \namespace qdata
var qdata = {};

// ============================================================================
// [Constants]
// ============================================================================

// `qdata.VERSION`
//
// Version information in a "major.minor.patch" form.
qdata.VERSION = "0.1.0";

// `qdata.kNoOptions`
//
// No data processing options. This constant has been added so the code that
// is using data processing can be more clear in cases where no options are
// used.
var kNoOptions = qdata.kNoOptions = 0x0000;

// `qdata.kExtractTopFields`
//
// Extract top fields from the source object.
//
// This option is used in case that you have a top level object that contains
// keys/values and you want to extract everything matching your schema out of
// it. Only keys defined in the schema are considered, others ignored silently.
//
// NOTE: This option can be combined with `kExtractAllFields`, in such case the
// latter has priority.
var kExtractTopFields = qdata.kExtractTopFields = 0x0001;

// `qdata.kExtractAllFields`
//
// Extract all fields from any source object.
//
// This is like `kExtractTopFields`, but it takes effect for any object, top
// level or nested. This option can be efficiently used to filter properties
// from source objects into properties defined by the schema.
var kExtractAllFields = qdata.kExtractAllFields = 0x0002;

// `qdata.kAccumulateErrors`
//
// Accumulate all errors instead of bailing out on the first failure.
//
// When this option is used the error object thrown in case of one or more
// error will always contain `errors` array that is populated by all errors
// found. This option is useful in cases that you want to see all problems
// of the input data - for example you want to highlight fields that are
// wrong on the client or perform an additional processing/fixing.
var kAccumulateErrors = qdata.kAccumulateErrors = 0x0004;

// \internal
//
// Flag used internally to generate a code for `qdata.test()`.
var kTestModeOnly = 0x0008;

// \internal
//
// Maximum number of functions that can be generated per one final schema. This
// is basically a last flag shifted one bit left. For example if the last bit is
// 0x8 the total number of functions generated per schema to cover all possible
// combinations would be 16 (indexed 0...15).
var kMaxFuncCount = 0x0008 << 1;

// Min/Max safe integer limits - 53 bits.
//
// NOTE: These should be fully compliant with ES6 `Number.isSafeInteger()`
var kSafeIntMin = qdata.kSafeIntMin = -9007199254740991;
var kSafeIntMax = qdata.kSafeIntMax =  9007199254740991;

// Min/Max year that can be used in date/datetime.
var kYearMin = qdata.kYearMin = 1;
var kYearMax = qdata.kYearMax = 9999;

// ============================================================================
// [Tuning]
// ============================================================================

// \internal
//
// If set to true the code generator will use `Object.keys(obj).length` to get
// the total count of properties `obj` has. This is turned off by default as it
// has been observed that simple `for (k in obj) props++` is much faster than
// calling `Object.keys()`.
var kTuneUseObjectKeysAsCount = false;

// ============================================================================
// [Internals]
// ============================================================================

var isArray = Array.isArray;
var hasOwnProperty = Object.prototype.hasOwnProperty;

// \internal
//
// Unsafe properties are properties that collide with `Object.prototype`. These
// are always checked by using hasOwnProperty() even if the field can't contain
// `undefined` value.
var unsafeProperties = Object.getOwnPropertyNames(Object.prototype);

// \internal
//
// Mapping of JS types into a one character describing the type. This mapping
// is used by `SchemaCompiler` to reduce the length of variable names generated
// and to map distinct types to different names in case of collision. This is
// good for JS engine as each variable will only contain a specific value type
// and JIT won't need to deoptimize it in case of type collision.
var mangledType = {
  array  : "a",
  boolean: "b",
  number : "n",
  object : "o",
  string : "s"
};

// ============================================================================
// [Core - Errors]
// ============================================================================

// \class RuntimeError
//
// Error thrown in case that `qdata` has been misused.
function RuntimeError(message) {
  var e = Error.call(this, message);

  this.name = "RuntimeError";
  this.message = message;
  this.stack = e.stack || "";
}
qdata.RuntimeError = qclass({
  $extend: Error,
  $construct: RuntimeError
});

function throwRuntimeError(msg) {
  throw new RuntimeError(msg);
}
qdata.throwRuntimeError = throwRuntimeError;

// \class SchemaError
//
// Error thrown in case of validation failure.
//
// The SchemaError is used in general in two ways:
//
//   1. `data` is an object - in this case the schema validator was configured
//      to out after the first error that have happened, and the `data` object
//      contains the error details. Data will be stored as an array having one
//      element that is the `data` argument to make the interface compatible
//      with `data` containing an array of errors.
//
//   2. `data` is an array - in this case the schema validator was configured
//      to accumulate all errors (by using `kAccumulateErrors` option).
//
// A single error entry contains the following properties:
//
//   "code": String - Code of the error (not a message).
//   "path": String - Path to the error (dot is used to separate nested fields).
//
// Each error can also contain any other properties that are specific to the
// type or rule.
function SchemaError(details) {
  var e = Error.call(this);

  if (!isArray(details))
    details = [details];

  this.name = "SchemaError";
  this.message = "Data processing failed.";
  this.stack = e.stack || "";

  this.details = details;
}
qdata.SchemaError = qclass({
  $extend: Error,
  $construct: SchemaError
});

function throwSchemaError(details) {
  throw new SchemaError(details);
}
qdata.throwSchemaError = throwSchemaError;

// ============================================================================
// [Core - Basics]
// ============================================================================

// \function `qdata.typeOf(val)`
//
// Get extended type of the object.
function typeOf(val) {
  var type = typeof val;
  if (type !== "object")
    return type;

  if (val === null)
    return "null";

  if (isArray(val))
    return "array";

  return "object";
}
qdata.typeOf = typeOf;

function copyObject(obj) {
  var dst = {};
  for (var k in obj)
    dst[k] = obj[k];
  return dst;
}

function _deepCopy(obj) {
  if (isArray(obj)) {
    var dstArr = [];
    var srcArr = obj;

    for (var i = 0, len = srcArr.length; i < len; i++) {
      var child = srcArr[i];
      dstArr.push((!child || typeof child !== "object") ? child : _deepCopy(child));
    }

    return dstArr;
  }
  else {
    var dstObj = {};
    var srcObj = obj;

    for (var k in srcObj) {
      var element = srcObj[k];
      dstObj[k] = (!element || typeof element !== "object") ? element : _deepCopy(element);
    }

    return dstObj;
  }
}

function deepCopy(value) {
  return (!value || typeof value !== "object") ? value : _deepCopy(value);
}
qdata.deepCopy = deepCopy;

// \internal
function _deepEqual(a, b, buffer) {
  var aType = typeof a;
  var bType = typeof b;

  // NaN !== NaN.
  if (aType === "number" && bType === "number")
    return true;

  // Anything else than object should be caught by `a === b`.
  if (a === null || aType !== "object" || b === null || bType !== "object")
    return false;

  var aIsArray = isArray(a);
  var bIsArray = isArray(b);

  var aValue;
  var bValue;

  var i, k;

  if (aIsArray & bIsArray) {
    var aLen = a.length;
    var bLen = b.length;

    if (aLen !== bLen)
      return false;

    // Detect cyclic references.
    for (i = 0; i < buffer.length; i += 2) {
      if (buffer[i] === a || buffer[i + 1] === b)
        throwRuntimeError("Detected cyclic references.");
    }

    buffer.push(a);
    buffer.push(b);

    for (var i = 0; i < aLen; i++) {
      aValue = a[i];
      bValue = b[i];

      if (aValue === bValue)
        continue;

      if (!_deepEqual(aValue, bValue, buffer))
        return false;
    }

    buffer.pop();
    buffer.pop();

    return true;
  }
  else if (aIsArray | bIsArray) {
    return false;
  }
  else {
    // Detect cyclic references.
    for (i = 0; i < buffer.length; i += 2) {
      if (buffer[i] === a || buffer[i + 1] === b)
        throwRuntimeError("Detected cyclic references.");
    }

    buffer.push(a);
    buffer.push(b);

    for (k in a) {
      if (!hasOwnProperty.call(a, k))
        continue;

      if (!hasOwnProperty.call(b, k))
        return false;
    }

    for (k in b) {
      if (!hasOwnProperty.call(b, k))
        continue;

      if (!hasOwnProperty.call(a, k))
        return false;

      aValue = a[k];
      bValue = b[k];

      if (aValue === bValue)
        continue;

      if (!_deepEqual(aValue, bValue, buffer))
        return false;
    }

    buffer.pop();
    buffer.pop();

    return true;
  }
}

// \function `qdata.deepEqual(a, b)`
//
// Get whether the values `a` and `b` are deep equal.
function deepEqual(a, b) {
  return (a === b) ? true : _deepEqual(a, b, []);
}
qdata.deepEqual = deepEqual;

// ============================================================================
// [Core - Util]
// ============================================================================

// \namespace `qdata.util`
//
// QData utility functions.
var qdata_util = qdata.util = {};

// ============================================================================
// [Core - Util - String]
// ============================================================================

// \internal
//
// Find a new line \n.
var newLineRE = /\n/g;

// \internal
//
// Used to unescape property name.
var unescapeFieldNameRE = /\\(.)/g;

// \internal
//
// Used to sanity an identifier.
var invalidIdentifierRE = /[^A-Za-z0-9_\$]/g;

// \function `qdata.string.isPropertyName(s)`
//
// Get whether the string `s` is a qdata's property name (ie it starts with "$").
function isPropertyName(s) {
  return s.charCodeAt(0) === 36;
}
qdata_util.isPropertyName = isPropertyName;

// \function `qdata.string.isVariableName(s)`
//
// Get whether the string `s` is a valid JS variable name:
//
//   - `s` is not an empty string.
//   - `s` starts with ASCII letter [A-Za-z], underscore [_] or a dollar sign [$].
//   - `s` may contain ASCII numeric characters, but not the first char.
//
// Please note that EcmaScript allows to use any unicode alphanumeric and
// ideographic characters to be used in a variable name, but this function
// doesn't allow these, only ASCII characters are considered. It basically
// follows the same convention as C/C++, with dollar sign [$] included.
function isVariableName(s) {
  if (!s)
    return false;

  var c;
  return !invalidIdentifierRE.test(s) && ((c = s.charCodeAt(0)) < 48 || c >= 58);
}
qdata_util.isVariableName = isVariableName;

// \function `qdata.string.escapeRegExp(s)`
//
// Escape a string `s` so it can be used in regexp for exact matching. For
// example a string "[]" will be escaped to "\\[\\]".
function escapeRegExp(s) {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}
qdata_util.escapeRegExp = escapeRegExp;

// \function `qdata.string.unescapeFieldName(s)`
//
// Unescape a given object's field name `s` to a real name (qdata specific).
function unescapeFieldName(s) {
  return s.replace(unescapeFieldNameRE, "$1");
}
qdata_util.unescapeFieldName = unescapeFieldName;

// \function `qdata.string.toCamelCase(s)`
//
// Make a string camelcased.
//
// This version of `toCamelCase()` preserves words that start with an uppercased
// character, so for example "CamelCased" string will be properly converted to
// "camelCased".
//
// Examples:
//
//   toCamelCase("ThisIsString")   -> "thisIsString"
//   toCamelCase("this-is-string") -> "thisIsString"
//   toCamelCase("THIS_IS_STRING") -> "thisIsString"
//   toCamelCase("this-isString")  -> "thisIsString"
//   toCamelCase("THIS_IsSTRING")  -> "thisIsString"
var toCamelCase = (function() {
  var re1 = /[A-Z]+/g;
  var fn1 = function(m) { return m[0] + m.substr(1).toLowerCase(); };

  var re2 = /[_-][A-Za-z]/g;
  var fn2 = function(m) { return m.substr(1).toUpperCase(); };

  function toCamelCase(s) {
    s = s.replace(re1, fn1);
    s = s.replace(re2, fn2);

    return s.charAt(0).toLowerCase() + s.substr(1);
  }

  return toCamelCase;
})();
qdata_util.toCamelCase = toCamelCase;

// ============================================================================
// [Core - Util - Color]
// ============================================================================

var colorNames = {
  "aliceblue"           : "#f0f8ff", "antiquewhite"        : "#faebd7",
  "aqua"                : "#00ffff", "aquamarine"          : "#7fffd4",
  "azure"               : "#f0ffff",
  "beige"               : "#f5f5dc", "bisque"              : "#ffe4c4",
  "black"               : "#000000", "blanchedalmond"      : "#ffebcd",
  "blue"                : "#0000ff", "blueviolet"          : "#8a2be2",
  "brown"               : "#a52a2a", "burlywood"           : "#deb887",
  "cadetblue"           : "#5f9ea0", "chartreuse"          : "#7fff00",
  "chocolate"           : "#d2691e", "coral"               : "#ff7f50",
  "cornflowerblue"      : "#6495ed", "cornsilk"            : "#fff8dc",
  "crimson"             : "#dc143c", "cyan"                : "#00ffff",
  "darkblue"            : "#00008b", "darkcyan"            : "#008b8b",
  "darkgoldenrod"       : "#b8860b", "darkgray"            : "#a9a9a9",
  "darkgreen"           : "#006400", "darkkhaki"           : "#bdb76b",
  "darkmagenta"         : "#8b008b", "darkolivegreen"      : "#556b2f",
  "darkorange"          : "#ff8c00", "darkorchid"          : "#9932cc",
  "darkred"             : "#8b0000", "darksalmon"          : "#e9967a",
  "darkseagreen"        : "#8fbc8f", "darkslateblue"       : "#483d8b",
  "darkslategray"       : "#2f4f4f", "darkturquoise"       : "#00ced1",
  "darkviolet"          : "#9400d3", "deeppink"            : "#ff1493",
  "deepskyblue"         : "#00bfff", "dimgray"             : "#696969",
  "dodgerblue"          : "#1e90ff",
  "firebrick"           : "#b22222", "floralwhite"         : "#fffaf0",
  "forestgreen"         : "#228b22", "fuchsia"             : "#ff00ff",
  "gainsboro"           : "#dcdcdc", "ghostwhite"          : "#f8f8ff",
  "gold"                : "#ffd700", "goldenrod"           : "#daa520",
  "gray"                : "#808080", "green"               : "#008000",
  "greenyellow"         : "#adff2f",
  "honeydew"            : "#f0fff0", "hotpink"             : "#ff69b4",
  "indianred"           : "#cd5c5c", "indigo"              : "#4b0082",
  "ivory"               : "#fffff0",
  "khaki"               : "#f0e68c",
  "lavender"            : "#e6e6fa", "lavenderblush"       : "#fff0f5",
  "lawngreen"           : "#7cfc00", "lemonchiffon"        : "#fffacd",
  "lightblue"           : "#add8e6", "lightcoral"          : "#f08080",
  "lightcyan"           : "#e0ffff", "lightgoldenrodyellow": "#fafad2",
  "lightgrey"           : "#d3d3d3", "lightgreen"          : "#90ee90",
  "lightpink"           : "#ffb6c1", "lightsalmon"         : "#ffa07a",
  "lightseagreen"       : "#20b2aa", "lightskyblue"        : "#87cefa",
  "lightslategray"      : "#778899", "lightsteelblue"      : "#b0c4de",
  "lightyellow"         : "#ffffe0", "lime"                : "#00ff00",
  "limegreen"           : "#32cd32", "linen"               : "#faf0e6",
  "magenta"             : "#ff00ff", "maroon"              : "#800000",
  "mediumaquamarine"    : "#66cdaa", "mediumblue"          : "#0000cd",
  "mediumorchid"        : "#ba55d3", "mediumpurple"        : "#9370d8",
  "mediumseagreen"      : "#3cb371", "mediumslateblue"     : "#7b68ee",
  "mediumspringgreen"   : "#00fa9a", "mediumturquoise"     : "#48d1cc",
  "mediumvioletred"     : "#c71585", "midnightblue"        : "#191970",
  "mintcream"           : "#f5fffa", "mistyrose"           : "#ffe4e1",
  "moccasin"            : "#ffe4b5",
  "navajowhite"         : "#ffdead", "navy"                : "#000080",
  "oldlace"             : "#fdf5e6", "olive"               : "#808000",
  "olivedrab"           : "#6b8e23", "orange"              : "#ffa500",
  "orangered"           : "#ff4500", "orchid"              : "#da70d6",
  "palegoldenrod"       : "#eee8aa", "palegreen"           : "#98fb98",
  "paleturquoise"       : "#afeeee", "palevioletred"       : "#d87093",
  "papayawhip"          : "#ffefd5", "peachpuff"           : "#ffdab9",
  "peru"                : "#cd853f", "pink"                : "#ffc0cb",
  "plum"                : "#dda0dd", "powderblue"          : "#b0e0e6",
  "purple"              : "#800080",
  "red"                 : "#ff0000", "rosybrown"           : "#bc8f8f",
  "royalblue"           : "#4169e1",
  "saddlebrown"         : "#8b4513", "salmon"              : "#fa8072",
  "sandybrown"          : "#f4a460", "seagreen"            : "#2e8b57",
  "seashell"            : "#fff5ee", "sienna"              : "#a0522d",
  "silver"              : "#c0c0c0", "skyblue"             : "#87ceeb",
  "slateblue"           : "#6a5acd", "slategray"           : "#708090",
  "snow"                : "#fffafa", "springgreen"         : "#00ff7f",
  "steelblue"           : "#4682b4",
  "tan"                 : "#d2b48c", "teal"                : "#008080",
  "thistle"             : "#d8bfd8", "tomato"              : "#ff6347",
  "turquoise"           : "#40e0d0",
  "violet"              : "#ee82ee",
  "wheat"               : "#f5deb3", "white"               : "#ffffff",
  "whitesmoke"          : "#f5f5f5",
  "yellow"              : "#ffff00", "yellowgreen"         : "#9acd32"
};
qdata_util.colorNames = colorNames;

function isColor(s, allowNames, extraNames) {
  var len = s.length;
  if (!len)
    return false;

  // Validate "#XXX" and "#XXXXXX".
  var c0 = s.charCodeAt(0);
  if (c0 === 35) {
    if (len !== 4 && len !== 7)
      return false;

    for (var i = 1; i < len; i++) {
      var c0 = s.charCodeAt(i);
      if (c0 < 48 || (c0 > 57 && (c0 |= 0x20) < 97 || c0 > 102))
        return false;
    }

    return true;
  }

  if (allowNames === false && extraNames != null)
    return false;

  s = s.toLowerCase();

  // Validate named entities.
  if (allowNames !== false && hasOwnProperty.call(colorNames, s))
    return true;

  // Validate extra table (can contain values like "currentColor", "none", ...)
  if (extraNames != null && hasOwnProperty.call(extraNames, s))
    return true;

  return false;
}
qdata_util.isColor = isColor;

// ============================================================================
// [Core - Util - IPV4 / IPV6]
// ============================================================================

function isIPV4(s) {
  // The smallest possible IPV4 address is "W.X.Y.Z", which is 7 characters long.
  var len = s.length;
  if (len < 7)
    return false;

  var i = 0;
  var n = 1;

  for (;;) {
    // Parse the first digit.
    var c0 = s.charCodeAt(i++);
    if (c0 < 48 || c0 > 57)
      return false;
    c0 -= 48;

    if (i === len)
      return n === 4;

    // Parse one or two consecutive digits and validate the value to be <= 256.
    var c1 = s.charCodeAt(i++);
    if (c1 >= 48 && c0 <= 57) {
      if (c0 === 0)
        return false;

      if (i === len)
        return n === 4;

      c0 = c0 * 10 + c1 - 48;
      c1 = s.charCodeAt(i++);

      if (c1 >= 48 && c1 <= 57) {
        c0 = c0 * 10 + c1 - 48;
        if (c0 > 255)
          return false;

        if (i === len)
          return n === 4;
        c1 = s.charCodeAt(i++);
      }
    }

    if (c1 !== 46 || i === len || ++n > 4)
      return false;
  }
}
qdata_util.isIPV4 = isIPV4;

function isIPV6(s) {
  // TODO: Implement.
  return false;
}
qdata_util.isIPV6 = isIPV6;

function isMAC(s, sep) {
  if (typeof sep !== "number")
    sep = 58; // ':'.

  // Mac has a format "AA:BB:CC:DD:EE:FF" which is exactly 17 characters long.
  if (s.length !== 17)
    return false;

  var i = 0;
  for (;;) {
    var c0 = s.charCodeAt(i    );
    var c1 = s.charCodeAt(i + 1);

    i += 3;

    if (c0 < 48 || (c0 > 57 && (c0 |= 0x20) < 97 || c0 > 102)) return false;
    if (c1 < 48 || (c1 > 57 && (c1 |= 0x20) < 97 || c1 > 102)) return false;

    if (i === 18)
      return true;

    if (s.charCodeAt(i - 1) !== sep)
      return false;
  }
}
qdata_util.isMAC = isMAC;

// ============================================================================
// [Core - Util - Date]
// ============================================================================

// Days in a month, leap years have to be handled separately.
//                (JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC)
var daysInMonth = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Leap seconds data.
//
// Every year has it's own data that is stored in a single number in a form 0xXY,
// where X represents a leap second in June-30 and Y represents Dec-31.
var leapSecondDates = {
  start: 1972,
  array: [
    /* 1972: */ 0x11, /* 1973: */ 0x01, /* 1974: */ 0x01, /* 1975: */ 0x01,
    /* 1976: */ 0x01, /* 1977: */ 0x01, /* 1978: */ 0x01, /* 1979: */ 0x01,
    /* 1980: */ 0x00, /* 1981: */ 0x10, /* 1982: */ 0x10, /* 1983: */ 0x10,
    /* 1984: */ 0x00, /* 1985: */ 0x10, /* 1986: */ 0x00, /* 1987: */ 0x01,
    /* 1988: */ 0x00, /* 1989: */ 0x01, /* 1990: */ 0x01, /* 1991: */ 0x00,
    /* 1992: */ 0x10, /* 1993: */ 0x10, /* 1994: */ 0x10, /* 1995: */ 0x01,
    /* 1996: */ 0x00, /* 1997: */ 0x10, /* 1998: */ 0x01, /* 1999: */ 0x00,
    /* 2000: */ 0x00, /* 2001: */ 0x00, /* 2002: */ 0x00, /* 2003: */ 0x00,
    /* 2004: */ 0x00, /* 2005: */ 0x01, /* 2006: */ 0x00, /* 2007: */ 0x00,
    /* 2008: */ 0x01, /* 2009: */ 0x00, /* 2010: */ 0x00, /* 2011: */ 0x00,
    /* 2012: */ 0x10, /* 2013: */ 0x00, /* 2014: */ 0x00, /* 2015: */ 0x10
  ]
};
qdata_util.leapSecondDates = leapSecondDates;

// \function `data.util.isLeapYear(year)`
//
// Get whether the `year` is a leap year (ie it has 29th February).
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0) ? 1 : 0;
}
qdata_util.isLeapYear = isLeapYear;

// \function `data.util.hasLeapSecond(year, month, day)`
//
// Get whether a date defined by `year`, `month`, and `day` has a leap second.
// Please note that it's impossible to guess leap second in the future. This
// function is mainly included to validate whether a date that has already
// passed or is in a near future has a leap second defined.
function isLeapSecondDate(year, month, date) {
  var msk = 0x00;

  if (month === 6 && date === 30)
    msk = 0x10;
  else if (month === 12 && date === 31)
    msk = 0x01;
  else
    return false;

  var data = leapSecondDates;
  var start = data.start;
  var array = data.array;
  var index = year - start;

  if (index < 0 || index >= array.length)
    return 0;

  return (array[index] & msk) !== 0;
}
qdata_util.isLeapSecondDate = isLeapSecondDate;

// \internal
var dateParts = {
  Y     : { len:-4, msk: 0x01 },
  YY    : { len: 2, msk: 0x01 },
  YYYY  : { len: 4, msk: 0x01 },
  M     : { len:-2, msk: 0x02 },
  MM    : { len: 2, msk: 0x02 },
  D     : { len:-2, msk: 0x04 },
  DD    : { len: 2, msk: 0x04 },
  H     : { len:-2, msk: 0x08 },
  HH    : { len: 2, msk: 0x08 },
  m     : { len:-2, msk: 0x10 },
  mm    : { len: 2, msk: 0x10 },
  s     : { len:-2, msk: 0x20 },
  ss    : { len: 2, msk: 0x20 },
  S     : { len: 1, msk: 0x40 },
  SS    : { len: 2, msk: 0x40 },
  SSS   : { len: 3, msk: 0x40 },
  SSSSSS: { len: 6, msk: 0x40 }
};

// \internal
//
// Get whether the given charcode is a date component (ie it can be parsed as
// year, month, date, etc...). Please note that not all alphanumeric characters
// are considered as date components.
function isDateComponent(c) {
  return (c === 0x59) | // 'Y' - Year.
         (c === 0x4D) | // 'M' - Month.
         (c === 0x44) | // 'D' - Day.
         (c === 0x48) | // 'H' - Hour.
         (c === 0x6D) | // 'm' - Minute.
         (c === 0x73) | // 's' - Second.
         (c === 0x53) ; // 'S' - Fractions of second.
}

// \internal
//
// Interface to create/cache date parsers based on date `format`.
var DateFactory = {
  // Get a date parser based on format passed as `format`. The object returned
  // has `format`, which is the same as `format` passed and `func`, which is a
  // compiled validation function. The result is cached and every `format` is
  // checked and compiled only once.
  get: function(format) {
    var cache = this.cache;

    if (hasOwnProperty.call(cache, format))
      return cache[format];

    var detail = this.inspect(format);
    var validator = {
      format: format,
      exec  : this.compile(format, detail)
    };

    cache[format] = validator;
    return validator;
  },

  // A mapping between a date format and a validator instance.
  cache: {},

  // Inspects a date format passed as `format`. If the format is valid and
  // non-ambiguous it returns an object that contains:
  //
  //   'Y', 'M', 'D', 'H', 'm', 's', 'S' - Information about date parts parsed in
  //     a `format` of object having `{ part, index, len }` properties.
  //
  //   'parts' - Date components and separators.
  //
  //   'fixed' - Whether ALL date components have fixed length (0 or 1).
  //
  //   'minLength' - Minimum length of a string to be considered valid and to be
  //     processed.
  inspect: function(format) {
    var i = 0;
    var len = format.length;

    // Split date components and separators, for example "YYYY-MM-DD" string
    // would be split into ["YYYY", "-", "MM", "-", "DD"] components.
    var parts = [];
    do {
      var start = i;
      var symb = format.charCodeAt(i);

      if (isDateComponent(symb)) {
        // Merge component chars, like "Y", "YY", "YYYY".
        while (++i < len && format.charCodeAt(i) === symb)
          continue;
      }
      else {
        // Parse anything that is not a date component.
        while (++i < len && !isDateComponent(format.charCodeAt(i)))
          continue;
      }

      parts.push(format.substring(start, i));
    } while (i < len);

    var index = 0;   // Component/Part string index, -1 if not usable.
    var fixed = 1;   // All components have fixed length.

    var msk = 0|0;   // Mask of parsed components.
    var sep = false; // Whether the current/next component has to be a separator.

    var insepected = {
      parts: null,
      fixed: 0,
      minLength: len
    };

    for (i = 0, len = parts.length; i < len; i++) {
      var part = parts[i];

      if (hasOwnProperty.call(dateParts, part)) {
        var data = dateParts[part];
        var symb = part.charAt(0);

        // Fail if one component appears multiple times or if the separator is
        // required at this point.
        if ((msk & data.msk) !== 0 || sep)
          throwRuntimeError("Invalid date format '" + format + "'.");
        msk |= data.msk;

        // Store the information about this date component. We always use the
        // format symbol `symb` as a key as it's always "Y" for all of "Y", "YY",
        // and "YYYY", for example.
        insepected[symb] = {
          part : part,
          index: fixed ? index : -1,
          len  : data.len
        };

        // Require the next component to be a separator if the component doesn't
        // have a fixed length. This prevents from ambiguities and one component
        // running through another in case of "YMD" for example.
        sep = data.len <= 0;

        // Update `fixed` flag in case this component's length is not fixed.
        fixed &= !sep;
      }
      else {
        // Reset the separator flag and add escaped part sequence into the regexp.
        sep = false;
      }

      index += part.length;
    }

    if (((msk + 1) & msk) !== 0)
      throwRuntimeError("Invalid date format '" + format + "'.");

    insepected.parts = parts;
    insepected.fixed = fixed;

    return insepected;
  },

  compile: function(format, detail) {
    var c = new CoreCompiler();

    var parts = detail.parts;
    var fixed = detail.fixed;

    var Y = detail.Y;
    var M = detail.M;
    var D = detail.D;
    var H = detail.H;
    var m = detail.m;
    var s = detail.s;

    var index = 0;
    var i, j;

    c.arg("input");
    c.arg("hasLeapYear");
    c.arg("hasLeapSecond");

    c.declareVariable("len", "input.length");
    c.declareVariable("cp", 0);

    c.emitComment("Date validator of '" + format + "' format.");
    c.emit("do {");

    c.emit("if (len " + (fixed ? "!==" : "<") + " " + detail.minLength + ") break;");
    c.emitNewLine();

    for (i = 0; i < parts.length; i++) {
      var part = parts[i];
      var symb = part.charAt(0);

      if (hasOwnProperty.call(detail, symb)) {
        var data = detail[symb];
        var jLen = data.len;

        // Generate code that parses the number and assigns its value into
        // a variable `symb`.
        c.declareVariable(symb);

        // If this component has a variable length we have to fix the parser
        // in a way that all consecutive components will use relative indexing.
        if (jLen <= 0 && index >= 0) {
          c.declareVariable("index", String(index));
          index = -1;
        }

        if (jLen > 0) {
          if (index < 0)
            c.emit("if (index + " + String(jLen) + " > len) break;");

          for (j = 0; j < jLen; j++) {
            var v = (j === 0) ? symb : "cp";
            var sIndex = (index >= 0) ? String(index + j) : "index + " + j;

            c.emit("if ((" + v + " = input.charCodeAt(" + sIndex + ") - 48) < 0 || " + v + " >= 10) break;");
            if (j !== 0)
              c.emit(symb + " = " + symb + " * 10 + " + v + ";");
          }

          if (index >= 0)
            index += jLen;
        }
        else {
          j = -jLen;

          c.declareVariable("limit");

          c.emit("if (index >= len) break;");
          c.emit("if ((" + symb + " = input.charCodeAt(index) - 48) < 0 || " + symb + " >= 10) break;");

          c.emitNewLine();
          c.emit("limit = Math.min(len, index + " + j + ");");

          c.emit("while (++index < limit && (cp = input.charCodeAt(index) - 48) >= 0 && cp < 10) {");
          c.emit(symb += " = " + symb + " * 10 + cp;");
          c.emit("}");
        }
      }
      else {
        // Generate code that checks if the separator sequence is correct.
        var cond = [];
        var jLen = part.length;

        if (index >= 0) {
          for (j = 0; j < jLen; j++)
            cond.push("input.charCodeAt(" + (index + j) + ") !== " + part.charCodeAt(j));
          index += jLen;
        }
        else {
          cond.push("index + " + jLen + " > len");
          for (j = 0; j < jLen; j++)
            cond.push("input.charCodeAt(index + " + j + ") !== " + part.charCodeAt(j));
        }

        c.emit("if (" + cond.join(" || ") + ") break;");

        if (index < 0)
          c.emit("index += " + jLen + ";");
      }

      c.emitNewLine();
    }

    if (Y) {
      c.emit("if (Y < " + kYearMin + ") break;");
      if (M) {
        c.emit("if (M < 1 || M > 12) break;");
        if (D) {
          c.declareData("daysInMonth", daysInMonth);
          c.emit("if (D < 1 || D > daysInMonth[M - 1] +\n" +
                 "    ((M === 2 && D === 29 && hasLeapYear && ((Y % 4 === 0 && Y % 100 !== 0) || (Y % 400 === 0))) ? 1 : 0))\n" +
                 "  break;");
        }
      }
    }

    if (H) {
      c.emit("if (H > 23) break;");
      if (m) {
        c.emit("if (m > 59) break;");
        if (s) {
          c.declareData("isLeapSecondDate", isLeapSecondDate);
          c.emit("if (s > 59 && !(s === 60 && hasLeapSecond && isLeapSecondDate(Y, M, D))) break;");
        }
      }
    }

    c.emit("return null;");
    c.emit("} while (false);");

    c.emitNewLine();
    c.emit("return { code: \"DateCheckFailure\", format: this.format };");

    return c.toFunction();
  }
};

// ============================================================================
// [Core - Enum]
// ============================================================================

function _sortIntFn(a, b) { return a - b; }

// \function `qdata.enum(def)`
//
// Create an enumeration, which is a mapping between a key (always a string) and
// a value, always a number.
//
// QData library knows how to recognize common patterns in enums and enriches
// the instance with metadata that can be used to improve and simplify data
// validation.
//
// The instance returned is always immutable, if JS environment allows it. This
// prevents from modifying an existing enumeration and thus breaking validators
// that have already been compiled and are cached.
function Enum(def) {
  // Enum is designed to be instantiated without using `new` operator.
  if (!(this instanceof Enum))
    return new Enum(def);

  if (!def || typeof def !== "object")
    throwRuntimeError("qdata.enum() - Invalid definition of type '" + typeOf(def) + "' passed.");

  var p = Enum.prototype;

  var keyList      = [];
  var valueMap     = {};
  var valueList    = [];

  var safe         = true;
  var unique       = true;
  var sequential   = true;

  // Move these functions closer to the object.
  this.$hasKey     = p.$hasKey;
  this.$keyToValue = p.$keyToValue;
  this.$hasValue   = p.$hasValue;
  this.$valueToKey = p.$valueToKey;

  this.$keyMap     = def;       // Mapping of keys to values.
  this.$keyList    = keyList;   // Array containing all keys.
  this.$valueMap   = valueMap;  // Mapping of values to keys.
  this.$valueList  = valueList; // Array containing all unique values, sorted.
  this.$valueKeys  = null;      // Keys in value order if all values are sequential.

  this.$min        = null;      // Minimum value (can be used to start a loop).
  this.$max        = null;      // Maximum value (can be used to end a loop).
  this.$safe       = true;      // True if all values are safe integers.
  this.$unique     = true;      // True if all values are unique (ie don't overlap).
  this.$sequential = true;      // True if all values form a sequence and don't overlap.

  for (var key in def) {
    if (!hasOwnProperty.call(def, key))
      continue;

    var val = def[key];
    var str = String(val);

    if (!key || key.charCodeAt(0) === 36 || typeof val !== "number" || !isFinite(val))
      throwRuntimeError("qdata.enum() - Invalid key/value pair '" + key +"' -> '" + str + "'.");

    if (!hasOwnProperty.call(valueMap, str)) {
      valueMap[str] = key;
      valueList.push(val);
    }
    else {
      unique = false;
    }

    if (Math.floor(val) !== val || val < kSafeIntMin || val > kSafeIntMax)
      safe = false;

    keyList.push(key);
    this[key] = val;
  }

  // Compute $min, $max, and $sequential properties.
  if (valueList.length) {
    valueList.sort(_sortIntFn);

    var a = valueList[0];
    var b = valueList[valueList.length - 1];
    var i;

    this.$min = a;
    this.$max = b;

    if (safe) {
      for (i = 1; i < valueList.length; i++) {
        if (++a !== valueList[i]) {
          sequential = false;
          break;
        }
      }

      // Replace `$hasValue` and `$valueToKey` by an optimized versions if all
      // values are sequential, so the mapping is not needed for making lookups.
      if (sequential) {
        var valueKeys = this.$valueKeys = [];

        for (i = 0; i < valueList.length; i++) {
          valueKeys.push(valueMap[String(valueList[i])]);
        }

        this.$hasValue = p.hasValue_Sequential;
        this.$valueToKey = p.$valueToKey_Sequential;
      }
    }
  }

  this.$safe = safe;
  this.$unique = unique;
  this.$sequential = sequential;
}
qdata.enum = qclass({
  $construct: Enum,

  // Get whether the enum has `key`.
  $hasKey: function(key) {
    if (typeof key !== "string")
      return undefined;

    return hasOwnProperty.call(this.$keyMap, key);
  },

  // Get a value based on `key`.
  $keyToValue: function(key) {
    if (typeof key !== "string")
      return undefined;

    var map = this.$keyMap;
    return hasOwnProperty.call(map, key) ? map[key] : undefined;
  },

  // Get whether the enum has `value`.
  $hasValue: function(value) {
    if (typeof value !== "number")
      return false;

    var str = String(value);
    return hasOwnProperty.call(this.$valueMap, str);
  },

  // \internal
  $hasValue_Sequential: function(value) {
    if (typeof value !== "number")
      return false;

    var min = this.$min;
    var max = this.$max;

    return !(value < min || value > max || Math.floor(value) !== value);
  },

  // Get a key based on `value`.
  $valueToKey: function(value) {
    if (typeof value !== "number")
      return undefined;

    var map = this.$valueMap;
    var str = String(value);
    return hasOwnProperty.call(map, str) ? map[str] : undefined;
  },

  // \internal
  $valueToKey_Sequential: function(value) {
    if (typeof value !== "number")
      return undefined;

    var min = this.$min;
    var max = this.$max;

    if (value < min || value > max || Math.floor(value) !== value)
      return undefined;

    return this.$valueKeys[value - min];
  }
});

// ============================================================================
// [Core - Compiler]
// ============================================================================

// \class `qdata.CoreCompiler`
//
// Base class used for compiling JS code. The reason there is `CoreCompiler`
// and not just `SchemaCompiler` is that `CoreCompiler` is used by other
// functions to compile much simpler JS code, like code for date parsing.
//
// CoreCompiler has been designed as a lightweight class that can be used to
// serialize JS code into one string, by providing an interface for indentation
// and declaring local variables at the beginning of the function.
//
// The following snippet demonstrates the desired functionality:
//
// ```
// var c = new CoreCompiler();
//
// c.arg("array");
// c.declareVariable("i", "0");
// c.declareVariable("len", "array.length");
//
// c.emit("while (i < len) {");
// c.declareVariable("element");
// c.emit("element = array[i]");
// c.emit("...");
// c.emit("i++;");
// c.emit("}";
//
// c.toFunction();
// ```
//
// The code above will generate and execute the following function:
//
// ```
// "use strict";
// function($$_data) {
//   return function(array) {
//     var i = 0, len = array.length, element;
//     while (i < len) {
//       element = array[i];
//       ...
//       i++;
//     }
//   }
// }
// ```
//
// The function above is a boilerplate that is needed to pass custom data to
// the generated function and the function that contains the body constructed
// by using `emit()` and others to emit JS code. Passing data is easy through
// `data(data)` method or more high level `declareData(name, data)` method.
function CoreCompiler() {
  this._debug = false;        // Whether to output debug code and comments.
  this._indentation = "  ";   // Indentation, see `indent()` and `deindent()`.

  this._args = [];            // Function arguments;
  this._body = "";            // Function body.

  this._locals = {};          // Local variables and initialization code.
  this._globals = {};         // Global variables and initialization code.
  this._uniqueName = 0;       // Unique variable names generator.

  this._data = [];            // Data that is passed to outer function.
  this._dataName = "$$_data"; // Reserved name for outer data argument.
  this._dataToVar = {};       // Mapping of global data index and variables.
}
qclass({
  $construct: CoreCompiler,

  // \internal
  _sanityIdentifierName: function(name) {
    return isVariableName(name) ? name : this._makeUniqueName();
  },

  // Declare a new local variable and put the declaration at the beginning of
  // the function.
  //
  // The function returns a variable name that is safe in case that the `name`
  // parameter contained name that is forbidden by JS.
  //
  // NOTE: If the variable already exists it only validates that `exp` is the
  // same as passed first time the variable has been declared. This makes it
  // possible to share variable names, but prevents changing their init code.
  declareVariable: function(name, exp) {
    var locals = this._locals;

    name = this._sanityIdentifierName(name);
    exp = exp || "";

    if (hasOwnProperty.call(locals, name)) {
      if (locals[name] !== exp)
        throwRuntimeError("Can't redeclare local variable '" + name + "' with different initialization '" + exp + "'");
    }
    else {
      locals[name] = exp;
    }

    return name;
  },

  // Declare a new global variable and put the declaration outside of the
  // generated function.
  //
  // Global variables can contain values that are constant to the function and
  // that can reference objects outside. For example you can add `qdata` global
  // and reference it inside the generated function.
  declareGlobal: function(name, exp) {
    var globals = this._globals;

    name = this._sanityIdentifierName(name);
    exp = exp || "";

    if (hasOwnProperty.call(globals, name)) {
      if (globals[name] !== exp)
        throwRuntimeError("Can't redeclare global variable '" + name + "' with different initialization '" + exp + "'");
    }
    else {
      globals[name] = exp;
    }

    return name;
  },

  declareData: function(name, data) {
    var exp = this.data(data);
    var map = this._dataToVar;

    if (!name) {
      if (hasOwnProperty.call(map, exp))
        name = map[exp];
      else
        name = this._makeUniqueName();
    }

    map[exp] = name;
    return this.declareGlobal(name, exp);
  },

  _makeUniqueName: function() {
    return "_" + (++this._uniqueName);
  },

  // Add an argument to the function.
  arg: function(name) {
    this._args.push(name);
    return this;
  },

  // Pass a data to the function, returns code that can be used to access it.
  data: function(data) {
    var array = this._data;
    var i = array.indexOf(data);

    if (i === -1) {
      i = array.length;
      array.push(data);
    }

    return this._dataName + "[" + i + "]";
  },

  // Emit JS `code` with current indentation applied.
  emit: function(code) {
    if (!code)
      return this;

    // Automatically deindent if the first character is '}'.
    if (code.charAt(0) === "}")
      this.deindent();

    this._body += this.applyIndentation(code);

    // Automatically indent if the last character is '{'.
    if (code.charAt(code.length - 1) === "{")
      this.indent();

    return this;
  },

  // Emit newline delimiter `\n`.
  emitNewLine: function() {
    this._body += "\n";
    return this;
  },

  // Emit comment with current indentation applied if debugging is enabled.
  emitComment: function(s) {
    if (this._debug)
      this._body += this.applyIndentation("// " + s.replace("\n", "\n// "));
    return this;
  },

  str: function(s) {
    return JSON.stringify(s);
  },

  indent: function() {
    this._indentation += "  ";
    return this;
  },

  deindent: function() {
    var s = this._indentation;
    this._indentation = s.substr(0, s.length - 2);
    return this;
  },

  applyIndentation: function(s) {
    if (!s)
      return s;

    if (s.charCodeAt(s.length - 1) === 10)
      s = s.substr(0, s.length - 1);

    var indentation = this._indentation;
    return indentation + s.replace(newLineRE, "\n" + indentation) + "\n";
  },

  serialize: function() {
    var globals = this._globals;
    var locals = this._locals;

    var init = "";
    var vars = "";
    var name, value;

    for (name in globals) {
      init += "var " + name + " = " + globals[name] + ";\n";
    }

    if (init)
      init += "\n";
    init = "\"use strict\";\n" + init;

    for (name in locals) {
      value = locals[name];
      vars += (vars ? ", " : "var ") + name + (value ? " = " + value : "");
    }

    if (vars) {
      vars += ";";
      vars = this.applyIndentation(vars);
    }

    return init +
      "return function(" + this._args.join(", ") + ") {\n" +
        vars +
        this._body +
      "}\n";
  },

  toFunction: function() {
    var body, fn;

    try {
      body = this.serialize();
      fn = new Function(this._dataName, body);

      //console.log(body);
      return fn(this._data);
    }
    catch (ex) {
      console.log("=========================================");
      console.log("INVALID CODE:");
      console.log(body);
      console.log("EXCEPTION:");
      console.log(ex);

      throwRuntimeError("Invalid code generated", {
        body   : body,
        message: ex.message
      });
    }
  }
});

// ============================================================================
// [Schema - Compiler]
// ============================================================================

// \internal
function mergePath(a, b) {
  if (!b)
    return a;

  // Merge `a` with an existing string `b`, results in less code to be emitted.
  if (a.charAt(a.length - 1) === '"' && b.charAt(0) === '"')
    return a.substr(0, a.length - 1) + b.substr(1);
  else
    return a + " + " + b;
}

// \class `qdata.SchemaCompiler`
function SchemaCompiler(env, options) {
  CoreCompiler.call(this);

  this._env = env;          // Schema environment (`qdata` or customized).
  this._options = options;  // Schema validation options.
  this._extract = false;    // Whether to extract properties from this level.

  this._nestedLevel = 0;    // Level of the current scope.
  this._ifLevel = 0;        // Count of IFs in the current scope.
  this._sectionLevel = 0;   // Section level.

  this._path = "\"\"";      // Path to the current scope (code).
  this._stack = [];         // Used to save state of the previous scope.
}
qclass({
  $extend: CoreCompiler,
  $construct: SchemaCompiler,

  compileFunc: function(def) {
    this.arg("input");

    this.declareData("qdata", this._env);
    this.declareVariable("err", "null");

    if (this.hasOption(kAccumulateErrors))
      this.declareVariable("details", "[]");

    if (this.hasOption(kExtractTopFields) || this.hasOption(kExtractAllFields))
      this.setExtract(true);

    var vIn = "input";
    var vOut = this.compileType(vIn, def);

    this.emitNewLine();

    if (this.hasOption(kAccumulateErrors)) {
      this.declareGlobal(
        "throwSchemaError", "qdata.throwSchemaError");
      this.emit(
        "if (details.length !== 0)\n" +
        "  throwSchemaError(details);\n" +
        "\n"
      );
    }

    if (this.hasOption(kTestModeOnly))
      this.emit("return true;");
    else
      this.emit("return " + vOut + ";");

    return this.toFunction();
  },

  compileType: function(vIn, def) {
    var name = def.$type || "object";
    var type = this._env.getType(name);

    if (!type)
      throwRuntimeError("Couldn't find handler for type " + name + ".");

    var vOut = type.compile(this, vIn, def);

    if (!this.hasOption(kTestModeOnly)) {
      this.emitNewLine();
      this.emit("if (err !== null) {");
      this.emitErrorCase();
      this.emit("}");
    }

    return vOut;
  },

  hasOption: function(option) {
    return (this._options & option ) !== 0;
  },

  // Handle a case at least `def.$null` or `def.$undefined` is `true`. It emits
  // code that handles `null` or `undefined` value, so the flow won't continue.
  //
  // NOTE: If both `$null` and `$undefined` are false this code does nothing.
  emitNullOrUndefinedCheck: function(def, vOut, vIn) {
    if (def.$null && def.$undefined)
      this.passIf(vIn + " == null", vOut, vIn);
    else if (def.$null)
      this.passIf(vIn + " === null", vOut, vIn);
    else if (def.$undefined)
      this.passIf(vIn + " === undefined", vOut, vIn);

    return this;
  },

  emitStringTypeCheck: function(def, v) {
    this.failIf("typeof " + v + " !== \"string\"",
      this.error(this.str("StringCheckFailure")));

    if (def.$length != null)
      this.failIf(v + ".length !== " + def.$length,
        this.error(this.str("InvalidLength")));

    if (def.$minLength != null && def.$maxLength == null)
      this.failIf(v + ".length < " + def.$minLength,
        this.error(this.str("InvalidLength")));

    if (def.$minLength == null && def.$maxLength != null)
      this.failIf(v + ".length > " + def.$maxLength,
        this.error(this.str("InvalidLength")));

    if (def.$minLength != null && def.$maxLength != null)
      this.failIf(v + ".length < " + def.$minLength + " || " + v + " > " + def.$maxLength,
        this.error(this.str("InvalidLength")));

    return this;
  },

  emitNumberCheck: function(def, v, minValue, maxValue, isInt, isFinite) {
    var min = def.$gt != null ? def.$gt : null;
    var max = def.$lt != null ? def.$lt : null;;

    var minEq = 0;
    var maxEq = 0;

    // Handle $gt, $ge, and $min.
    if (def.$ge != null && (min === null || min <= def.$ge)) {
      min = def.$ge;
      minEq = 1;
    }

    if (def.$min != null && (min === null || min <= def.$min)) {
      min = def.$min;
      minEq = 1;
    }

    if (minValue != null && (min === null || min <= minValue)) {
      min = minValue;
      minEq = 1;
    }

    // Handle $lt, $le, and $max.
    if (def.$le != null && (max === null || max >= def.$le)) {
      max = def.$le;
      maxEq = 1;
    }

    if (def.$max != null && (max === null || max >= def.$max)) {
      max = def.$max;
      maxEq = 1;
    }

    if (maxValue != null && (max === null || max >= maxValue)) {
      max = maxValue;
      maxEq = 1;
    }

    // Emit.
    var cond = [];

    // Finite check is only important if there is no range check. By default
    // all integer checks have range (because of the int type), however, doubles
    // have no range by default.
    if (isFinite && (min === null || max === null)) {
      cond.push("isFinite(" + v + ")");
    }

    // JS integer type is a 32-bit number that can have values in range from
    // -2147483648 to 2147483647 - for this range it's safe to check for an
    // integer type by `(x|0) === x`, otherwise this trick is not possible and
    // more portable `Math.floor(x) === x` has to be used.
    if (isInt) {
      var minIsSafe = (min !== null) && min >= -2147483648 - (1 - minEq);
      var maxIsSafe = (max !== null) && max <=  2147483647 + (1 - maxEq);

      if (minIsSafe && maxIsSafe) {
        cond.push("(" + v + "|0) === " + v);

        // Remove min/max checks if covered by `(x|0) === x`.
        if (min + (1 - minEq) === -2147483648) min = null;
        if (max - (1 - maxEq) ===  2147483647) max = null;
      }
      else {
        cond.push("Math.floor(" + v + ") === " + v);
      }
    }

    if (min !== null)
      cond.push(v + (minEq ? " >= " : " > ") + min);

    if (max !== null)
      cond.push(v + (maxEq ? " <= " : " < ") + max);

    if (cond.length > 0)
      this.failIf("!(" + cond.join(" && ") + ")",
        this.error(this.str("OutOfRange")));

    return this;
  },

  emitErrorCase: function(code) {
    if (this.hasOption(kTestModeOnly)) {
      this.emit("return false;");
    }
    else {
      if (code)
        this.emit(code);
      this.emit("err.path = " + this.path() + ";");

      if (this.hasOption(kAccumulateErrors)) {
        this.emit("details.push(err);");
        this.emit("err = null;");
      }
      else {
        this.declareGlobal(
          "throwSchemaError", "qdata.throwSchemaError");
        this.emit("throwSchemaError(err);");
      }
    }

    return this;
  },

  addLocal: function(name, mangledType) {
    return this.declareVariable("_" + this._nestedLevel + (mangledType || "") + "_" + name);
  },

  // Get a type-prefix of type defined by `def`.
  mangledType: function(def) {
    var env = this._env;

    // Default mangled type is an object.
    var mangled = "o";

    if (typeof def.$type === "string") {
      var type = env.getType(def.$type);
      if (type)
        mangled = mangledType[type.type] || "x";
    }

    return mangled;
  },

  emitIf: function(cond, body) {
    var ifKeyword = (++this._ifLevel === 1) ? "if" : "else if";

    this.emit(ifKeyword + " (" + cond + ") {");
    this.emit(body);
    this.emit("}");

    return this;
  },

  passIf: function(cond, vOut, vIn) {
    if (vOut === vIn)
      return this.emitIf(cond, "// PASS.");
    else
      return this.emitIf(cond, vOut + " = " + vIn + ";");
  },

  failIf: function(cond, code) {
    if (this.hasOption(kTestModeOnly)) {
      return this.emitIf(cond, "return false;");
    }
    else {
      if (code !== "err")
        code = "err = " + code + ";";
      else
        code = "// FAIL.";

      return this.emitIf(cond, code);
    }
  },

  getPath: function() {
    return this._path;
  },

  setPath: function(path) {
    var prev = this._path;
    this._path = path;
    return prev;
  },

  addPath: function(sep, code) {
    var p = this._path;
    if (p !== '""' && sep)
      p = mergePath(p, sep);
    return this.setPath(mergePath(p, code));
  },

  getExtract: function() {
    return this._extract;
  },

  setExtract: function(value) {
    var prev = this._extract;
    this._extract = value;
    return prev;
  },

  path: function() {
    return this._path;
  },

  error: function(objectOrCode) {
    if (typeof objectOrCode === "object")
      return JSON.stringify(objectOrCode);
    else
      return "{ \"code\": " + objectOrCode + " }";
  },

  beginSection: function() {
    this.emit(this._ifLevel === 0 ? "if (1) {" : "else {");
    this._ifLevel = 0;
    this._sectionLevel++;
    return this;
  },

  endSection: function() {
    if (--this._sectionLevel < 0)
      throwRuntimeError("Invalid call to endSection(), there are no more sections.");

    this.emit("}");
    this._ifLevel = 0;

    return this;
  },

  done: function() {
    this._ifLevel = 0;
    return this;
  },

  // Begin nesting of the current object/array.
  nest: function() {
    this._stack.push({
      ifLevel: this._ifLevel
    });

    this._ifLevel = 0;
    this._nestedLevel++;

    return this;
  },

  // End nesting of the current object/array.
  denest: function() {
    var state = this._stack.pop();

    this._ifLevel = state.ifLevel;
    this._nestedLevel--;

    return this;
  }
});

// ============================================================================
// [Schema - Builder]
// ============================================================================

// \internal
//
// Test if the given key is an optional type "...?".
var _isOptionalFieldRE = /\?$/;

// \internal
//
// Test if the given key is an array type "...[]".
var _isArrayFieldRE = /\[\]$/;

// \internal
//
// Translate a given schema definition into internal format that can be used
// by `qdata` library. This function is called for root type and all children
// it contains, basically per recognized type.
function _schemaField(def, env, priv) {
  // Safe defaults.
  var name = def.$type || "object";
  var defData = def.$data;

  var hasNull = false;
  var hasUndef = false;

  var obj, k;

  // If the $type ends with "?" it implies `{ $null: true }` definition.
  if (_isOptionalFieldRE.test(name)) {
    name = name.substr(0, name.length - 1);
    hasNull = true;

    // Prevent from having invalid type that contains for example "??" by mistake.
    if (_isOptionalFieldRE.test(name))
      throwRuntimeError("Invalid type '" + def.$type + "'.");
  }

  // If the $type ends with "[]" it implies `{ $type: "array", $data: ... }`.
  // In this case all definitions specified in `def` are related to the array
  // elements, not the array itself.
  if (_isArrayFieldRE.test(name)) {
    var nested = copyObject(def);
    nested.$type = name.substr(0, name.length - 2);

    obj = {
      $type     : "array",
      $data     : _schemaField(nested, env, null),
      $null     : hasNull,
      $undefined: false,
      $_private : priv
    };
  }
  else {
    if (typeof def.$null === "boolean")
      hasNull = def.$null;

    if (typeof def.$undefined === "boolean")
      hasUndef = def.$undefined;

    obj = {
      $type     : name,
      $data     : null,
      $null     : hasNull,
      $undefined: hasUndef,
      $_private : priv
    };

    if (name === "object") {
      var $data = obj.$data = {};

      for (k in def) {
        var kDef = def[k];

        // Properties are stored in `obj` itself, however, object fields are
        // stored always in `obj.$data`. This is just a way to distinguish
        // properties from object fields.
        if (!isPropertyName(k))
          $data[unescapeFieldName(k)] = _schemaField(kDef, env, null);
        else if (!hasOwnProperty.call(obj, k))
          obj[k] = kDef;
      }

      if (defData != null) {
        if (typeof defData !== "object")
          throwRuntimeError("Property '$data' has to be object, not '" + typeOf(defData) + "'.");

        for (k in defData) {
          kDef = defData[k];
          $data[k] = _schemaField(kDef, env, null);
        }
      }
    }
    else {
      for (k in def) {
        if (!isPropertyName(k))
          throwRuntimeError("Data field '" + k + "'can't be used by '" + name + "' type.");

        if (!hasOwnProperty.call(obj, k))
          obj[k] = def[k];
      }

      if (defData != null) {
        if (typeof defData !== "object")
          throwRuntimeError("Property '$data' has to be object, not '" + typeOf(defData) + "'.");

        obj.$data = _schemaField(defData, env, null);
      }
    }
  }

  // Validate that the postprocessed object is valid and can be compiled.
  var type = env.getType(obj.$type);
  if (!type)
    throwRuntimeError("Unknown type '" + obj.$type + "'.");

  if (typeof type.hook === "function")
    type.hook(obj, env);

  return obj;
}

// \function `qdata.schema(def)`
//
// Processes the given definition `def` and creates a schema that can be used
// and compiled by `qdata` library. It basically normalizes the input object
// and calls `type` and `rule` hooks on it.
function schema(def) {
  // All members starting with `$_private` are considered private and used
  // exclusively by QData library. This is the only reserved prefix so far.
  var priv = { func: new Array(kMaxFuncCount) };
  return _schemaField(def, this || qdata, priv);
}
qdata.schema = schema;

// ============================================================================
// [Schema - Interface]
// ============================================================================

// \function `qdata.compile(def, options)`
//
// Compile and return a function that can be used to process data based
// on definition `def` and options given in `options`. The function returned
// is NOT associated with the given `def`, use more high-level `qdata.process()`
// to process data by using functions that are cached.
function compile(def, options) {
  return (new SchemaCompiler(this || qdata, options || 0)).compileFunc(def);
}
qdata.compile = compile;

// \function `qdata.process(data, def, options, access)`
//
// Process the given `data` by using a definition `def`, `options` and `access`
// rights. The function specific for the validation type and options is compiled
// on demand and then cached.
function process(data, def, options, access) {
  var fnArray = def.$_private.func;
  var fnIndex = options || 0;

  var fn = fnArray[fnIndex];
  if (!fn)
    fnArray[fnIndex] = fn = compile.call(this, def, fnIndex);

  return fn(data, access);
}
qdata.process = process;

function precompileProcess(def, options) {
  var fnArray = def.$_private.func;
  var fnIndex = options || 0;

  return fnArray[fnIndex] || (fnArray[fnIndex] = compile.call(this, def, fnIndex));
}
qdata.precompileProcess = precompileProcess;

// \function `qdata.test(data, def, options, access)`
//
// Tests the given `data` by using a definition `def`, `options` and `access`
// right.
function test(data, def, options, access) {
  var fnArray = def.$_private.func;
  var fnIndex = (options || 0) | kTestModeOnly;

  var fn = fnArray[fnIndex];
  if (!fn)
    fnArray[fnIndex] = fn = compile.call(this, def, fnIndex);

  return fn(data, def, access);
}
qdata.test = test;

function precompileTest(def, options) {
  var fnArray = def.$_private.func;
  var fnIndex = (options || 0) | kTestModeOnly;

  return fnArray[fnIndex] || (fnArray[fnIndex] = compile.call(this, def, fnIndex));
}
qdata.precompileTest = precompileTest;

// ============================================================================
// [Schema - Customize]
// ============================================================================

// \object `qdata.types`
//
// Types supported by `qdata`. Mapping between a type names (or aliases) and
// type objects.
qdata.types = {};

// \object `qdata.rules`
//
// Rules supported by `qdata`. Mapping between a rule names and rule objects.
qdata.rules = {};

// \function `qdata.getType(name)`
//
// Get a type by `name`.
//
// The function also matches type aliases.
function getType(name) {
  var types = this.types;
  return (hasOwnProperty.call(types, name)) ? types[name] : null;
}
qdata.getType = getType;

// \function `qdata.addType(t)`
//
// Add a type or types to the `qdata` environment.
//
// The type `t` can be an array of types or a single type. The type added
// is a POD object having the following signature:
//
// ```
// {
//   // Type names/aliases, like `["int"]` or `["int", "integer", ...]`,
//   name: String[]
//
//   // Javascript type of a given field.
//   type: String
//     "array"   - Array
//     "boolean" - Boolean
//     "number"  - Number (double or integer, doesn't matter)
//     "object"  - Object
//     "string"  - String (character or string, doesn't matter)
//
//   // Function that compiles a given type.
//   compile: Function(c, v, def) { ... }
// }
// ```
function addType(data) {
  var types = this.types;

  if (!isArray(data))
    data = [data];

  for (var i = 0; i < data.length; i++) {
    var type = data[i];
    var name = type.name;

    for (var n = 0; n < name.length; n++) {
      types[name[n]] = type;
    }
  }

  return this;
}
qdata.addType = addType;

// \function `qdata.getRule(name)`
//
// Get a rule by `name`.
function getRule(name) {
  var rules = this.rules;
  return (hasOwnProperty.call(rules, name)) ? rules[name] : null;
}
qdata.getRule = getRule;

// \function `qdata.addRule(rule)`
//
// Add a rule or rules to the `qdata` environment.
function addRule(data) {
  var rules = this.rules;

  if (!isArray(data))
    data = [data];

  for (var i = 0; i < data.length; i++) {
    var rule = data[i];
    rules[rule.name] = rule;
  }

  return this;
}
qdata.addRule = addRule;

// \function `qdata.customize(opt)`
//
// Extend the `qdata` library by custom types and rules. It returns a completely
// new object that acts as `qdata` library itself. This is the recommended way
// of extending `qdata` library.
//
// For example let's say that you have your own type `CustomType` and you want
// to extend the library. The recommended way is to extend `qdata` and use the
// extended library in your code base (node.js example):
//
// ```
// var qdata = require("qdata");
//
// var CustomType = {
//   ...
// };
//
// var xdata = qdata.customize({
//   types: [
//     CustomType
//   ]
// });
//
// // Export the new interface and always use your library to load the custom
// // version of `qdata`.
// module.exports = xdata;
// ```
//
// The advantage of this approach is that changes are not made globally and the
// new types or rules can be accessed only through the new `qdata` like object
// returned.
function customize(opt) {
  if (opt == null)
    opt = {};

  if (typeOf(opt) !== "object")
    throwRuntimeError(
      "qdata.customize(opt) - The `opt` parameter has to be an object, received " + typeOf(opt) + ".");

  // Create a new `qdata` like object.
  var obj = copyObject(this || qdata);
  var tmp, i;

  // Clone members that can change.
  obj.types = copyObject(obj.types);
  obj.rules = copyObject(obj.rules);

  // Customize types and/or rules if provided.
  tmp = opt.types;
  if (tmp)
    obj.addType(tmp);

  tmp = opt.rules;
  if (tmp)
    obj.addRule(tmp);

  return obj;
}
qdata.customize = customize;

// ============================================================================
// [Schema Type - Bool]
// ============================================================================

qdata.addType({
  name: ["boolean", "bool"],
  type: "boolean",

  compile: function(c, v, def) {
    c.emitNullOrUndefinedCheck(def, v, v);

    c.failIf("typeof " + v + " !== \"boolean\"",
      c.error(c.str("BoolCheckFailure")));

    return v;
  }
});

// ============================================================================
// [Schema Type - Int / Double]
// ============================================================================

qdata.addType({
  name: [
    // Double types.
    "double",
    "number",

    // Integer types.
    "integer",
    "int"  , "uint"  ,
    "int8" , "uint8" ,
    "int16", "uint16",
    "short", "ushort",
    "int32", "uint32",

    // Latitude/Longitude types.
    "lat", "latitude",
    "lon", "longitude"
  ],

  compile: function(c, v, def) {
    var type = def.$type;

    var minValue = null;
    var maxValue = null;

    var isInt = false;
    var isFinite = true;

    c.emitNullOrUndefinedCheck(def, v, v);

    switch (type) {
      case "number":
      case "double":
        break;
      case "integer":
      case "int":
        isInt = true;
        minValue = kSafeIntMin;
        maxValue = kSafeIntMax;
        break;
      case "uint":
        isInt = true;
        minValue = 0;
        maxValue = kSafeIntMax;
        break;
      case "int8":
        isInt = true;
        minValue = -128;
        maxValue = 127;
        break;
      case "uint8":
        isInt = true;
        minValue = 0;
        maxValue = 255;
        break;
      case "int16":
      case "short":
        isInt = true;
        minValue = -32768;
        maxValue = 32767;
        break;
      case "uint16":
      case "ushort":
        isInt = true;
        minValue = 0;
        maxValue = 65535;
        break;
      case "int32":
        isInt = true;
        minValue = -2147483648;
        maxValue = 2147483647;
        break;
      case "uint32":
        isInt = true;
        minValue = 0;
        maxValue = 4294967295;
        break;
      case "lat":
      case "latitude":
        minValue = -90;
        maxValue = 90;
        break;
      case "lon":
      case "longitude":
        minValue = -180;
        maxValue = 180;
        break;
      default:
        throwRuntimeError("Invalid type '" + type + "'.");
    }

    var errorCode = isInt ? "IntCheckFailure" : "DoubleCheckFailure";
    c.failIf("typeof " + v + " !== \"number\"", c.error(c.str(errorCode)));
    c.emitNumberCheck(def, v, minValue, maxValue, isInt, isFinite);

    // DivBy check.
    if (def.$divBy != null)
      c.failIf(v + " % " + def.$divBy + " !== 0",
        c.error(c.str("DivByFailure")));

    return v;
  }
});

// ============================================================================
// [Schema Type - Char]
// ============================================================================

qdata.addType({
  name: ["char"],
  type: "string",

  compile: function(c, v, def) {
    c.emitNullOrUndefinedCheck(def, v, v);

    c.failIf("typeof " + v + " !== \"string\" || " + v + ".length !== 1",
      c.error(c.str("CharCheckFailure")));

    return v;
  }
});

// ============================================================================
// [Schema Type - String / Text]
// ============================================================================

// Text is basically a string with some characters restricted:
//   - [00] NUL Null
//   - [01] SOH Start of Heading
//   - [02] STX Start of Text
//   - [03] ETX End of Text
//   - [04] EOT End of Transmission
//   - [05] ENQ Enquiry
//   - [06] ACK Acknowledge
//   - [07] BEL Bell
//   - [08] BS  Back Space
//   - [0B] VT  Vertical Tab
//   - [0C] FF  Form Feed
//   - [0E] SO  Shift Out
//   - [0F] SI  Shift In
//   - [10] DLE Data Line Escape
//   - [11] DC1 Device Control 1
//   - [12] DC2 Device Control 2
//   - [13] DC3 Device Control 3
//   - [14] DC4 Device Control 4
//   - [15] NAK Negative Acknowledge
//   - [16] SYN Synchronous Idle
//   - [17] ETB End of Transmit Block
//   - [18] CAN Cancel
//   - [19] EM  End of Medium
//   - [1A] SUB Substitute
//   - [1B] ESC Escape
//   - [1C] FS  File Separator
//   - [1D] GS  Group Separator
//   - [1E] RS  Record Separator
//   - [1F] US  Unit Separator
var isInvalidTextRE = /[\x00-\x08\x0B-\x0C\x0E-\x1F]/;

qdata.addType({
  name: ["string", "text"],
  type: "string",

  compile: function(c, v, def) {
    c.emitNullOrUndefinedCheck(def, v, v);
    c.emitStringTypeCheck(def, v);

    if (def.$type === "text") {
      var reText = c.declareData(null, isInvalidTextRE);
      c.failIf(reText + ".test(" + v + ")",
        c.error(c.str("TextCheckFailure")));
    }

    if (def.$re != null) {
      var reCustom = c.declareData(null, def.$re);
      c.failIf(reCustom + ".test(" + v + ")",
        c.error(c.str(def.$reError || "RegExpFailure")));
    }

    return v;
  }
});

// ============================================================================
// [Schema Type - Date / Time / DateTime]
// ============================================================================

qdata.addType({
  name: ["date", "datetime", "datetime-ms", "datetime-us"],
  type: "string",

  hook: function(def, env) {
    var type = def.$type;
    var format = def.$format || this.formats[type];

    if (typeof format !== "string")
      throwRuntimeError("Invalid date format '" + format + "'.");

    def.$validator = DateFactory.get(format);
  },

  compile: function(c, v, def) {
    var vErr = "err";

    c.emitNullOrUndefinedCheck(def, v, v);
    c.failIf("typeof " + v + " !== \"string\"",
      c.error(c.str("DateCheckFailure")));

    var validator = c.declareData(null, def.$validator);
    var hasLeapYear = true;
    var hasLeapSecond = false;

    // Default `$leapYear` value is `true`.
    if (def.$leapYear === false)
      hasLeapYear = false;

    // Default `$leapSecond` value is `false`.
    if (def.$leapSecond === true)
      hasLeapSecond = true;

    c.failIf("(" +
      vErr + " = " + validator + ".exec(" +
        v + ", " +
        hasLeapYear + ", " +
        hasLeapSecond + ")" +
      ")", vErr);

    return v;
  },

  formats: {
    "date"       : "YYYY-MM-DD",
    "datetime"   : "YYYY-MM-DD HH:mm:ss",
    "datetime-ms": "YYYY-MM-DD HH:mm:ss.SSS",
    "datetime-us": "YYYY-MM-DD HH:mm:ss.SSSSSS"
  }
});

// ============================================================================
// [Schema Type - Color]
// ============================================================================

qdata.addType({
  name: ["color"],
  type: "string",

  compile: function(c, v, def) {
    var errorCode = "ColorCheckFailure";
    var allowNames = true;
    var extraNames = null;

    if (def.$allowNames === false) {
      allowNames = def.$allowNames;
      if (typeof allowNames !== "boolean")
        throwRuntimeError("Invalid colorNames type '" + typeOf(allowNames) + "'.");
    }

    if (def.$extraNames != null) {
      extraNames = def.$extraNames;
      if (typeof extraNames !== "object" || isArray(extraNames))
        throwRuntimeError("Invalid extraNames type '" + typeOf(extraNames) + "'.");
    }

    var fn = c.declareData(null, isColor);
    var en = null;

    if (extraNames)
      en = c.declareData(null, extraNames);

    c.emitNullOrUndefinedCheck(def, v, v);
    c.failIf("typeof " + v + " !== \"string\" || !" + fn + "(" + v + ", " + allowNames + ", " + en + ")",
      c.error(c.str(errorCode)));

    return v;
  }
});

// ============================================================================
// [Schema Type - MAC Address]
// ============================================================================

qdata.addType({
  name: ["mac"],
  type: "string",

  compile: function(c, v, def) {
    var errorCode = "MACCheckFailure";
    var separator = def.$separator || ":";

    if (separator.length !== 1)
      throwRuntimeError("Invalid MAC address separator '" + separator + "'.");

    var fn = c.declareData(null, isMAC);

    c.emitNullOrUndefinedCheck(def, v, v);
    c.failIf("typeof " + v + " !== \"string\" || !" + fn + "(" + v + ", " + separator.charCodeAt(0) + ")",
      c.error(c.str(errorCode)));

    return v;
  }
});

// ============================================================================
// [Schema Type - IP Address]
// ============================================================================

qdata.addType({
  name: ["ipv4", "ipv6"],
  type: "string",

  compile: function(c, v, def) {
    var type = def.$type;

    var errorCode;
    var validator;

    switch (type) {
      case "ipv4":
        errorCode = "IPV4CheckFailure";
        validator = qdata_util.isIPV4;
        break;
      case "ipv6":
        errorCode = "IPV6CheckFailure";
        validator = qdata_util.isIPV6;
        break;
      default:
        throwRuntimeError("Invalid type '" + type + "'.");
    }

    var fn = c.declareData(null, validator);

    c.emitNullOrUndefinedCheck(def, v, v);
    c.failIf("typeof " + v + " !== \"string\" || !" + fn + "(" + v + ")",
      c.error(c.str(errorCode)));

    return v;
  }
});

// ============================================================================
// [Schema Type - Object]
// ============================================================================

qdata.addType({
  name: ["object"],
  type: "object",

  hook: function(def, env) {
    var rules = qdata.rules;

    for (var k in rules) {
      var rule = rules[k];
      rule.hook(def, env);
    }
  },

  compile: function(c, v, def) {
    var vLen = "";
    var vOut = c.hasOption(kTestModeOnly) ? v : c.addLocal("out", c.mangledType(this.type));

    var toString = c.declareGlobal("toString", "Object.prototype.toString");

    // Type of null/{} is "object". So if "null" nor "undefined" types are allowed
    // this condition catches them both. We don't have to worry about these in
    // case that one of them is allowed as in such case it will be caught by
    // `emitNullOrUndefinedCheck()` and input would have never reached here.
    c.emitNullOrUndefinedCheck(def, vOut, v);
    c.failIf("" + v + " == null || (" + v + ".constructor !== Object && " + toString + ".call(" + v + ") !== \"[object Object]\")",
      c.error(c.str("ObjectCheckFailure")));

    c.beginSection();
    c.nest();

    var fields = def.$data;
    var mandatoryFields = [];
    var optionalFields = [];

    var eKey, eDef, eMangledType;
    var eIn, eOut;

    var i;
    var path = c.getPath();
    var extract = c.setExtract(c.hasOption(kExtractAllFields));

    // Collect information regarding mandatory and optional keys.
    for (eKey in fields) {
      eDef = fields[eKey];

      if (eDef == null || typeof eDef !== "object")
        throwRuntimeError("Invalid field definition, expected object, got " + typeOf(eDef) + ".");

      if (eDef.$optional)
        optionalFields.push(eKey);
      else
        mandatoryFields.push(eKey);
    }

    // If the extraction mode is off we have to make sure that there are no
    // properties in the source object that are not defined by the schema.
    if (!extract) {
      vLen = c.addLocal("kl", "_");
      c.emit(vLen + " = " + mandatoryFields.length + ";");
    }

    if (mandatoryFields.length) {
      var mandatoryVars = [];

      for (i = 0; i < mandatoryFields.length; i++) {
        eKey = mandatoryFields[i];
        eDef = fields[eKey];

        var isUnsafeProperty = eDef.$undefined || unsafeProperties.indexOf(eKey) !== -1;

        eMangledType = c.mangledType(eDef);
        eIn = c.addLocal(eKey, eMangledType);

        c.addPath('"."', c.str(eKey));
        if (isUnsafeProperty) {
          c.declareGlobal("hasOwnProperty", "Object.prototype.hasOwnProperty");
          c.emit("if (hasOwnProperty.call(" + v + ", " + c.str(eKey) + ")) {");
        }
        c.emit(eIn + " = " + v + "[" + c.str(eKey) + "];");

        eOut = c.compileType(eIn, eDef);
        mandatoryVars.push(eOut);

        if (isUnsafeProperty) {
          c.emit("}");
          c.emit("else {");
          c.emitErrorCase("err = " + c.error(c.str("RequiredField")) + ";");
          c.emit("}");
        }

        c.emitNewLine();
        c.setPath(path);
        c.done();
      }

      if (!c.hasOption(kTestModeOnly)) {
        c.emit(vOut + " = {");
        for (i = 0; i < mandatoryFields.length; i++) {
          eKey = mandatoryFields[i];
          eOut = mandatoryVars[i];

          c.emit(c.str(eKey) + ": " + eOut + (i + 1 < mandatoryFields.length ? "," : ""));
        }
        c.emit("};");
      }
    }
    else {
      if (!c.hasOption(kTestModeOnly)) {
        c.emit(vOut + " = {};");
      }
    }

    if (optionalFields.length) {
      for (i = 0; i < optionalFields.length; i++) {
        eKey = optionalFields[i];

        c.emitNewLine();

        c.declareGlobal("hasOwnProperty", "Object.prototype.hasOwnProperty");
        c.emit("if (hasOwnProperty.call(" + v + ", " + c.str(eKey) + ")) {");

        eMangledType = c.mangledType(eDef);
        eIn = c.addLocal(eKey, eMangledType);

        if (!extract)
          c.emit(vLen + "++;");

        c.emit(eIn + " = " + v + "[" + c.str(eKey) + "];");
        c.addPath('"."', c.str(eKey));
        eOut = c.compileType(eIn, eDef);
        c.setPath(path);

        if (!c.hasOption(kTestModeOnly))
          c.emit(vOut + "[" + c.str(eKey) + "] = " + eOut + ";");

        c.emit("}");
        c.done();
      }
    }

    if (!extract) {
      c.declareVariable("dummy");
      c.emitNewLine();

      if (kTuneUseObjectKeysAsCount) {
        c.emit("if (Object.keys(" + v + ").length !== " + vLen + ") {");
      }
      else {
        c.emit("for (dummy in " + v + ") " + vLen + "--;");
        c.emit("");
        c.emit("if (" + vLen + " !== 0) {");
      }

      if (c.hasOption(kTestModeOnly)) {
        c.emit("return false;");
      }
      else {
        var fn = c.declareData("extractionFailed", this.extractionFailed);
        c.emit("err = " + fn + "(" + vOut + ", " + v + ");");
      }

      c.emit("}");
    }

    c.denest();
    c.endSection();
    c.setExtract(extract);

    return vOut;
  },

  // Called from compiled code to generate a list containing all invalid
  // properties.
  extractionFailed: function(dst, src) {
    var list = [];

    for (var k in src)
      if (!hasOwnProperty.call(dst, k))
        list.push(k);

    return {
      code: "InvalidProperty",
      list: list
    };
  }
});

// ============================================================================
// [Schema Type - Array]
// ============================================================================

qdata.addType({
  name: ["array"],
  type: "array",

  compile: function(c, v, def) {
    var vIdx = c.addLocal("idx", "_");
    var vLen = c.addLocal("len", "_");
    var vOut = c.hasOption(kTestModeOnly) ? v : c.addLocal("out", c.mangledType(this.type));

    c.emitNullOrUndefinedCheck(def, vOut, v);
    c.failIf("!Array.isArray(" + v + ")",
      c.error(c.str("ArrayCheckFailure")));

    c.beginSection();
    c.nest();

    c.emit(vLen + " = " + v + ".length;");
    if (!c.hasOption(kTestModeOnly))
      c.emit(vOut + " = [];");

    var cond = [];
    if (def.$length != null)
      cond.push(vLen + " !== " + def.$length);

    if (def.$minLength != null)
      cond.push(vLen + " < " + def.$minLength);

    if (def.$maxLength != null)
      cond.push(vLen + " > " + def.$maxLength);

    if (cond.length) {
      c.failIf(cond.join(" && "),
        c.error(c.str("InvalidLength")));
      c.beginSection();
    }

    c.emitNewLine();
    c.emit("for (" + vIdx + " = 0; " + vIdx + " < " + vLen + "; " + vIdx + "++) {");

    var eDef = def.$data;
    if (eDef == null || typeof eDef !== "object")
      throwRuntimeError("Invalid ArrayType.$data definition, expected object, got " + typeOf(eDef) + ".");

    var eMangledType = c.mangledType(eDef);
    var eIn = c.addLocal("element", eMangledType);

    c.emit(eIn + " = " + v + "[" + vIdx + "];");

    var prevPath = c.addPath("", '"[" + ' + vIdx + ' + "]"');
    var eOut = c.compileType(eIn, eDef);

    if (!c.hasOption(kTestModeOnly))
      c.emit(vOut + ".push(" + eOut + ");");

    c.emit("}");
    c.setPath(prevPath);

    if (cond.length) {
      c.endSection();
    }

    c.denest();
    c.endSection();

    return vOut;
  }
});

// ============================================================================
// [Schema Rule - Id]
// ============================================================================

// Processes `$pk` and `$fk` properties of "object" type and generate the
// following
//
//   - `$pkArray` - Primary key array.
//   - `$pkMap`   - Primary key map.
//   - `$fkArray` - Foreign key array.
//   - `$fkMap`   - Foreign key map.
qdata.addRule({
  name: "id",

  hook: function(def, env) {
    var pkArray = [];
    var pkMap = {};

    var fkArray = [];
    var fkMap = {};

    var data = def.$data;
    for (var key in data) {
      var field = data[key];

      // TODO: Implement.
    }

    def.$pkArray = pkArray;
    def.$pkMap   = pkMap;

    def.$fkArray = fkArray;
    def.$fkMap   = fkMap;
  }
});

// ============================================================================
// [Exports]
// ============================================================================

$export[$as] = qdata;

}).apply(this, typeof module === "object"
  ? [require("qclass"), module, "exports"]
  : [this.qclass, this, "qdata"]);
