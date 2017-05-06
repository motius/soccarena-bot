"use strict"

const nodemailer = require('nodemailer')
const Datastore = require('nedb')
const Promise = require('bluebird')
const x = require('x-ray')()

const Config = require('./config/config.js')
const db = new Datastore({ filename: './db/arena.db', autoload: true })

const DEBUG = false
const INTERVAL = Config.INTERVAL || 15 * 60 * 1000 // Check every 15 mins
const COURT = 1,
  DATE = 2,
  START = 3,
  END = 4

const COURTS = {
  1: 10,
  2: 10,
  3: 10,
  4: 10,
  5: 8
}

// Return next dayOfWeek in yyyy-mm-dd format
function getNextDayOfWeek(dayOfWeek) {
  let today = new Date(),
    resultDate = new Date()

  resultDate.setDate(today.getDate() + (7 + dayOfWeek - today.getDay()) % 7)

  if (resultDate.getDate() <= today.getDate())
    resultDate.setDate(resultDate.getDate() + 7)

  return formatDate(resultDate)
}

function formatDate(date) {
  let tzo = -date.getTimezoneOffset(),
    dif = tzo >= 0 ? '+' : '-',
    pad = function(num) {
      var norm = Math.abs(Math.floor(num));
      return (norm < 10 ? '0' : '') + norm;
    }

  return date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate())
}

// Check for an opening
function check() {
  console.log("Checking for empty slots... " + new Date().toLocaleString())

  let dayURL = {
    friday: Config.BASE_URL + getNextDayOfWeek(5), // Friday
    saturday: Config.BASE_URL + getNextDayOfWeek(6), // Saturday
    sunday: Config.BASE_URL + getNextDayOfWeek(0) // Sunday
  }

  let toEmail = []
  let parseDays = []

  for (let day in dayURL) {
    parseDays.push(Promise.promisify(x(dayURL[day], ["td > a:contains('frei')@href"]))())
  }

  Promise.all(parseDays)
    .then(values => {
      return parse([].concat.apply([], values))
    })
    .then(records => {
      return prepareMail(records)
    })
    .then(text => {
      if (text != null)
        return sendMail(text)
      else
        console.log("No new slots found... " + new Date().toLocaleString())
    })
}

function parse(slots) {
  if (!slots || slots.length == 0) {
    return []
  }

  let records = slots.map(function(link) {
    const re = /^http.+?court=([0-9])&datum=([0-9\-]+)&startZeit=(\d\d.+?\d\d)&endZeit=(\d\d.+?\d\d)/g
    let groups = re.exec(link)
    return {
      court: groups[COURT],
      date: groups[DATE],
      start: groups[START].replace("%3A", ":"),
      end: groups[END].replace("%3A", ":"),
      _id: link
    }
  })

  let insertSlots = []
  records.forEach(function(record) {
    insertSlots.push(insert(db, record))
  })

  return Promise.all(insertSlots)
    .then(values => {
      let newSlots = []
      values.forEach(function(doc) {
        if (doc == null)
          return
        newSlots.push(doc)
      })
      return newSlots
    })
}

function prepareMail(records) {
  records.sort(function(a, b) {
    let keyA = new Date(a.date),
      keyB = new Date(b.date)

    // Compare the 2 dates
    if (keyA < keyB) return -1
    if (keyA > keyB) return 1
    return 0
  })

  let mailText = " <div> "

  if (records.length == 1) {
    mailText += "<p> I found a slot: </p>"
    mailText += mailFormat(records[0])
  } else if (records.length > 1) {
    mailText += "I found " + records.length + " slots:\n"
    records.forEach(function(rec) {
      mailText += mailFormat(rec)
    })
  } else {
    return null
  }
  mailText += " </div> "
  return mailText
}

function mailFormat(rec) {
  return " <p> " +
    "Court: " + rec.court + " (" + COURTS[rec.court] + " people) <br /> " +
    "Date: " + (new Date(rec.date)).toLocaleDateString() + " <br /> " +
    rec.start + " - " + rec.end + " <br /> " +
    "<a href='" + rec._id + "'>Click here to book</a> </p> "
}

// Send mail to receivers
function sendMail(data) {
  console.log("Sending email...")

  // create reusable transporter object using the default SMTP transport
  const transporter = nodemailer.createTransport(Config.SMTP)

  // setup e-mail data with unicode symbols
  let mailOptions = {
    from: Config.MAIL_FROM, // sender address
    to: Config.MAIL_TO, // list of receivers
    subject: 'Soccarena Update: ' + new Date().toLocaleString(), // Subject line
    text: 'I found something', // plaintext body
    html: data
  }

  console.log(mailOptions)
  if (DEBUG) {
    return
  }

  // send mail with defined transport object
  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
      return console.log(error)
    }
    console.log('Message sent: ' + info.response)
  })
}

function insert(db, rec) {
  return new Promise(function(resolve, reject) {
    db.insert(rec, function(err, doc) {
      if (err)
        resolve(null)
      else
        resolve(doc)
    })
  })
}

check()
setInterval(check, INTERVAL)
