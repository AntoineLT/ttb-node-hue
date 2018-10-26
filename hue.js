/*

Modified for the Thingbox
Digital Airways 2015

*/


/**
 * Copyright 2015 Urbiworx.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
 
var urllib = require("url");
var fs = require("fs");
var hue = require("node-hue-api");
var Chromath = require('chromath')

module.exports = function(RED) {
    "use strict";
	var upnpresult=new Array();
	var config=null;
	
	var userDir="";
	if (RED.settings.userDir){
		userDir=RED.settings.userDir+"/";
	}
	var readConfiguration = function(id){
		var conf = {};
		try{
			var _t = JSON.parse(fs.readFileSync(userDir+"nodes_configurations/"+id+".json"));
			conf.deviceid = _t.deviceid;
			conf.serverid = _t.serverid;
		}catch(e){
			conf.deviceid="";
			conf.serverid="";
		}
		return conf;
	};
	
	fs.readFile(userDir+'nodes_configurations/hue.config', function (err, data) {
		if (err!=null){
			config={};
			return;
		}
		config=JSON.parse(data);
	});
	hue.nupnpSearch(function(err, result) {
		if (err) throw err;
		upnpresult=result;
	});
	
    function HueNodeOut(n) {
        RED.nodes.createNode(this,n);
		var that=this;
		var _c = readConfiguration(this.id);
		this.deviceid=_c.deviceid;
		this.serverid=_c.serverid;
  	
		this.ip=getIpForServer(this.serverid);
		this.on("input",function(msg) {
			if (!that.ip){
				that.ip=getIpForServer(this.serverid);
			}
			var api=new hue.HueApi(that.ip,config[that.serverid]);
			if (that.deviceid.indexOf("g-")==0){
				api.getGroup(that.deviceid.substring(2),function(err, result) {
					if (err){
						that.send([null,{payload:err}]);
					} else {
						that.send([{payload:result.lastAction},null]);
					}
				});
			} else {
					api.lightStatus(that.deviceid, function(err, result) {
					if (err){
						that.send([null,{payload:err}]);
					} else {
						that.send([{payload:result},null]);
					}
				});
			}
		});
    }
    RED.nodes.registerType("Hue Pull",HueNodeOut);
	
	function HueNodeSet(n) {
        RED.nodes.createNode(this,n);
		var that=this;
		var _c = readConfiguration(this.id);
		this.deviceid=_c.deviceid;
		this.serverid=_c.serverid;

		this.ip=getIpForServer(this.serverid);
		this.on("input",function(msg) {
			if (!that.ip){
				that.ip=getIpForServer(this.serverid);
			}
			var api=new hue.HueApi(that.ip,config[that.serverid]);
			var lightState=hue.lightState.create();
			if(msg.transitiontime)
				lightState=lightState.transitiontime.call(lightState,msg.transitiontime);
			
			// Use Thingbox intents
			
			if(msg.intent===undefined) {
				// try to use the payload if no intents
				msg.intent = msg.payload;
			}
      
			if(msg.intent == 0)
				lightState=lightState.on.call(lightState, false);
			if(msg.intent == 1)
				lightState=lightState.on.call(lightState, true);
				
			if(msg.brightness != undefined)
				lightState=lightState.bri.call(lightState,msg.brightness);
				
			if(msg.intensity != undefined)
				lightState=lightState.bri.call(lightState,msg.intensity*2.55); // l'intensity est sur 100 et la valeur demandée sur 255
				
			if(msg.hue != undefined)
				lightState=lightState.hue.call(lightState,msg.hue);
				
			if(msg.saturation != undefined)
				lightState=lightState.saturation.call(lightState,msg.saturation);
			
			if(msg.color){
				try {
					var rgb = new Chromath(msg.color).toRGBArray();
					lightState.rgb(rgb);
				}
				catch(e){
					that.warn("bad format color. (ex. #ffffff)");
				}
			}
			
			var resultFunction=function(err, lights) {
				if (err){
					that.send([null,{payload:err}]);
				} else {
					that.send([{payload:lights},null]);
				}
			}
			if (that.deviceid.indexOf("g-")==0){
				api.setGroupLightState(that.deviceid.substring(2),lightState,resultFunction);
			} else {
				api.setLightState(that.deviceid,lightState,resultFunction);
			}
		});
    }
	RED.nodes.registerType("Hue Set",HueNodeSet);
	
	function getIpForServer(server){
		for (var i=0;i<upnpresult.length;i++){
			if(upnpresult[i].id===server){
				return upnpresult[i].ipaddress;
			}
		}
	}
	
	RED.httpAdmin.get('/philipshue/server', function(req, res, next){
		hue.nupnpSearch(function(err, result) {
			if (err) throw err;
			upnpresult=result;
			if(!Array.isArray(result)){
				result = [result];
			}
			var _p = [];
			for(var i in result){
				var r = result[i];
				(function(ip, id) {
					var _api = new hue.HueApi(ip, "Node RED");
					_p.push(new Promise(function(resolve, reject){
						_api.config().then(c => {
							c.host = ip;
							c.id = id;
							resolve(c);
						}).catch(err => {
							resolve(null);
						});
					}));
				})(r.ipaddress, r.id);
			}
			Promise.all(_p).then(function(values){
				var bridges = [{}];
				for(var i in values){
					if(values[i] !== null){
						bridges.push({
							id: values[i].id,
							name: values[i].name || "HUE Bridge (" + this._config.host + ")"
						});
					}
				}
				res.end(JSON.stringify(bridges));
			}).catch(err => {
				res.end(JSON.stringify("[]"));
			});
		});
		return;
	});
	RED.httpAdmin.get('/philipshue/devices/:serverid', function(req, res, next){
		var returnDevices=function(){
			var api=new hue.HueApi(ip,config[req.params.serverid]);
			api.getFullState(function(err, config) {
				if (err) throw err;
				res.end(JSON.stringify({lights:config.lights,groups:config.groups}));
			});	
		}
		
		var ip=getIpForServer(req.params.serverid);
		if(typeof(config[req.params.serverid])==="undefined"){
			(new hue.HueApi()).createUser(ip, function(err, user) {
				if (err!=null){
					res.end(JSON.stringify({error:1}));
					return;
				}
				config[req.params.serverid]=user;
				fs.writeFile(userDir+"nodes_configurations/hue.config",JSON.stringify(config));
				returnDevices();
			});
		} else {
			returnDevices();
		}		
	});
    
	RED.httpAdmin.get("/philipshue/:nodeid/server/:serverid/device/:deviceid/select", function(req, res, next){
		var _sid = req.params.serverid;
		var _did = req.params.deviceid;
		if(_sid == null || _did == null){
			return;
		}
		if(!fs.existsSync(userDir+"nodes_configurations/")){
			fs.mkdirSync(userDir+"nodes_configurations/");
		}
		console.log("Set HUE ",_sid,_did);
		fs.writeFileSync(userDir+"nodes_configurations/"+req.params.nodeid+".json", JSON.stringify({"serverid":_sid,"deviceid":_did}));
	});

	RED.httpAdmin.get("/philipshue/:nodeid/configuration", function(req, res, next){
		var _c = readConfiguration(req.params.nodeid);
		
		res.end(JSON.stringify(_c));
	});
}