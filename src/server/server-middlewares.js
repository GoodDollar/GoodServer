import bodyParser from "body-parser"
import addLoginMiddlewares from "./login/login-middleware"

export default (app, env) => {
  // parse application/x-www-form-urlencoded
  // for easier testing with Postman or plain HTML forms
  app.use(bodyParser.urlencoded({
    extended: true
  }));


  // parse application/json
  app.use(bodyParser.json())

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "Authorization, Origin, X-Requested-With, Content-Type, Accept");
    next()
  })

  addLoginMiddlewares(app)
}
