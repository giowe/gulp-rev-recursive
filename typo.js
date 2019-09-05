"use strict"

module.exports = {
  fixed(string, minChars) {
    const len = string.length
    if (len < minChars) {
      for (let i = 0; i < minChars - len; i++) {
        string += " "
      }
    }
    return string
  },

  repeat(string, times) {
    let out = ""
    for (let i = 0; i < times; i++) {
      out += string
    }
    return out
  }
}
