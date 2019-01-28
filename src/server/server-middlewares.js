import bodyParser from "body-parser"
import addLoginMiddlewares from "./login/login-middleware"
import { setup as addGunMiddlewares } from "./gun/gun-middleware"
import addStorageMiddlewares from "./storage/storageAPI"
import { GunDBPrivate } from "./gun/gun-middleware"

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
  addGunMiddlewares(app)
  addStorageMiddlewares(app, GunDBPrivate)

  app.use((error, req, res, next) => {
    console.log({error});
    res.status(400).json({ message: error.message });
  });

}
