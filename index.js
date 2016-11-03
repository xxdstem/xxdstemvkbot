const request = require("request");
const fs = require('fs');
const vk = new (require('vk-io'));
const SerializableMap = require('./SerializableMap');
const SerializableSet = require('./SerializableSet');

const config = JSON.parse(fs.readFileSync('config.json'));

const commands_filename = config.commands_filename;
const bayan_filename = config.bayan_filename;
const ignore_list_filename = config.ignore_list_filename;

var stationary_commands = new SerializableMap();
var bayan_checker = new SerializableSet();
var ignore_list = new SerializableSet();

function hashFnv32a(str, asString, seed)
{

    var i, l,
        hval = (seed === undefined) ? 0x811c9dc5 : seed;

    for (i = 0, l = str.length; i < l; i++) {
        hval ^= str.charCodeAt(i);
        hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
    }
    if( asString ){
        // Convert to 8 digit hex string
        return ("0000000" + (hval >>> 0).toString(16)).substr(-8);
    }
    return hval >>> 0;
    //return str;
}

function initializeStructure(structure,filename, initializerList)
{
    if (fs.existsSync(filename))
    {
        structure.load_from_file(filename);
    }
    else
    {
        if (initializerList)
            structure.initializeFromArray(initializerList);
    }
}

initializeStructure(stationary_commands, commands_filename);
initializeStructure(bayan_checker, bayan_filename);
initializeStructure(ignore_list, ignore_list_filename);

const defaultSubreddit = config.defaultSubreddits;
const defaultYandere = config.defaultYandere;

const dicker_photos = ["photo9680305_360353548","photo9680305_373629840","photo9680305_356010821","photo9680305_340526271","photo9680305_324159352","photo9680305_248221743","photo297755100_438730139"];
const admins = config.admins;
const max_bayan_counter = 10;

var command_queue = [];

function getRandomInt(min, max)
{
    return Math.floor(Math.random() * (max - min)) + min;
}

function parseYanderesPic(str)
{
    const reg_str = '<a class="directlink largeimg" href=.*?><span class="directlink-info">';

    var regexp = new RegExp(reg_str,'g');
    var result = [];
    str.match(regexp).forEach(function (elem)
    {
        result.push(elem.toString().slice(37,-32));
    });
    return result;
}

function parseRedditPic(str, index)
{
    var parsed_body = JSON.parse(str)['data']['children'][index]['data'];
    var pic = parsed_body['preview']['images'][0]['source']['url'];
    var link = parsed_body['permalink'];
    var title = parsed_body['title'];
    return {pic:pic,link:link,title:title};
}

vk.setToken(config.token);

vk.longpoll().then(() =>
{
    console.log('Longpoll запущен!');
});

function randomArrayElement(arr)
{
    return arr[getRandomInt(0,arr.length)];
}

function parseYandexNews(str)
{
    const reg_str = '<a href=.*?class="link list__item-content link_black_yes" aria-label=".*?>';

    var regexp = new RegExp(reg_str,'g');
    var result = '';
    var i = 1;
    str.match(regexp).forEach(function (elem)
    {
        if (elem.indexOf('Изменить город') == -1) {

            var link_exp = new RegExp('<a href=".*?"');
            var title_exp = new RegExp('aria-label=".*?"');

            if (i <= 5 && Math.random() > 0.5) {
                result += i + '. ' + (elem.match(title_exp).toString().slice(12, -1)) + ' (' + (elem.match(link_exp).toString().slice(9, -1)) + ')' + '\n';
                i++;
            }
        }
    });
    return result;
}

function parseBashQuote(str)
{
    return str.replace('<br.+?/>','\n');
}

function saveFiles()
{
    stationary_commands.save_to_file(commands_filename);
    bayan_checker.save_to_file(bayan_filename);
    ignore_list.save_to_file(ignore_list_filename);
}

function generateRequestString(msg)
{
    return 'REQUEST: ' + msg.text + '\n';
}

//TODO for xxdstem -> add captcha handler
/*vk.setCaptchaHandler((src,again) => {
    handleCaptcha(src)
        .then((code) => {
            again(code)
                .then(() => {
                    console.log('Капча введена верно!');
                })
                .catch(() => {
                    console.error('Капча введена не верно!');
                });
        });
});*/

vk.on('message',(msg) =>
{
    console.log(msg);

    var msgtext = "";
    if(msg.text != null)
        msgtext = msg.text;
    var sender = msg.user;

    command_queue.forEach(function (elem) {
        if (elem.author == sender)
        {
            sendMessage('Команда ' + elem.key + (stationary_commands.has(elem.key) ? ' изменена!' : ' добавлена!'), false);
            stationary_commands.add(elem.key, {message:msgtext, forward_messages:msg.id});
            elem.key = '';
        }
    });
    command_queue = command_queue.filter((x) => x.key != '');

    function sendVkPic(picLink,message)
    {
        vk.upload.message({
            file: picLink
        }).then(function(data) {
            var pik_id = data['owner_id']+"_"+data['id'];
            return msg.send(message,{ attach: "photo"+pik_id, fwd:false});
        });
    }

    function sendMessage(message, copy_request)
    {
        if (copy_request === false)
            return msg.send(message,{fwd:false});
        else
            return msg.send(request_str + message,{fwd:false});
    }

    function processContent(contentRetrieval,contentSender, bayanCheck)
    {
        try
        {
            var answer = undefined;
            var i = 0;
            while(!answer || bayanCheck(answer))
            {
                answer = contentRetrieval();
                i++;
                if (i > max_bayan_counter)
                    break;
            }
            if (i > max_bayan_counter)
                sendMessage('Забаянился');
            else
                contentSender(answer);
        }
        catch (err)
        {
            sendMessage("хуйня какая-та!");
        }
    }

    function checkMinArgsNumber(args, min)
    {
        if (args.length < min)
        {
            sendMessage('Нужно минимум ' + min + ' аргументов!');
            return false;
        }
        return true;
    }

    function sendMessageObject(msgObject)
    {
        //console.log(params);
        return msg.send(msgObject);
    }

    function check_stationary_command(message)
    {
        stationary_commands.forEach(function (value,key)
        {
            if (message == key)
            {
                sendMessageObject(value);
            }
        });
    }

    function checkIgnore(arg)
    {
        if (ignore_list.has(arg) && admins.indexOf(sender) == -1)
            sendMessage("Эта хуйня в игноре!");
        else
            return true;
        return false;
    }

    function processYandereRequest(body)
    {
        processContent(function () {
            return randomArrayElement(parseYanderesPic(body));
        },function (answer) {
            sendVkPic(answer,request_str);
        },function (answer) {
            return bayan_checker.add(hashFnv32a(answer));
        });
    }

    function parseForwardedMessagesIds(fwds)
    {
        return fwds.map(function (elem) {
            return elem.id;
        }).join(',');
    }

    if (msgtext.startsWith('!'))
    {
        var words = msgtext.split(' ');
        var command = words[0].slice(1).toLowerCase();
        var args = words.slice(1);
        var request_str = generateRequestString(msg);
        if (command == 'yan')
        {
            if (args.length == 0)
            {
                args = [randomArrayElement(defaultYandere)];
                request_str += 'fixed to ' + args[0] + '\n';
            }
            if (checkIgnore(args[0])) {
                if (args[0] == 'digger' || args[0] == 'dicker_photos' || args[0] == 'диккер') {
                    msg.send("ееее диккер!",{ attach: randomArrayElement(dicker_photos), fwd:false});
                }
                else {
                    request.get("https://yande.re/post?tags=" + args[0], function (err, res, body) {
                        if (body.indexOf('Nobody here but us chickens!') != -1) {
                            request.get("https://yande.re/tag?name=" + args[0] + "&type=&order=count", function (err, res, body) {
                                //console.log(body);
                                var elem_exp = /<td align="right">[^]*?>\?<\/a>/g;

                                var count_exp = '<td align="right">.*?</td>';
                                var title_exp = /title=.*?>/i;

                                var matches = body.match(elem_exp);

                                //console.log(matches);

                                var counts = [];
                                var sum = 0;
                                var titles = [];

                                if (!matches) {
                                    sendMessage('No matches found!');
                                    return;
                                }

                                matches.forEach(function (elem) {
                                    //console.log(elem);
                                    var count = (+elem.match(new RegExp(count_exp)).toString().slice(6, -2));
                                    var title = elem.match(new RegExp(title_exp)).toString().slice(6, -2);

                                    counts.push(count);
                                    titles.push(title);
                                    sum += count;

                                });

                                //console.log(titles);

                                var v = getRandomInt(0, sum);

                                var c = 0;
                                var i = 0;
                                while (c < v) {
                                    c += counts[i];
                                    i++;
                                }

                                args[0] = titles[i];

                                request_str += 'fixed to ' + args[0] + '\n';

                                request.get("https://yande.re/post?tags=" + args[0], function (err, res, body) {
                                    processYandereRequest(body);
                                });
                            });
                        }
                        else {
                            processYandereRequest(body);
                        }
                    });
                }
            }
        }

        if (command == 'pic' || command == 'пик')
        {
            if (args.length == 0)
            {
                args = [randomArrayElement(defaultSubreddit)];
                request_str += 'fixed to ' + args[0] + '\n';
            }
            if (checkIgnore(args[0]))
            {
                request.get("https://www.reddit.com/r/"+args[0]+"/new/.json", function(err,res,body)
                {
                    processContent(function () {
                        return parseRedditPic(body,getRandomInt(0,25));
                    },function (answer) {
                        sendVkPic(answer.pic,request_str + answer.title + '\n' + "https://www.reddit.com"+answer.link);
                    },function (answer) {
                        return bayan_checker.add(hashFnv32a(answer.pic));
                    });
                });
            }
        }

        if (command == 'bash')
        {
            request.get('http://bohdash.com/random/bash/random.php', function(err,res,body)
            {
                processContent(function () {
                    return parseBashQuote(body);
                },sendMessage,
                    function (answer)
                    {
                        return bayan_checker.add(hashFnv32a(answer));
                    });
            });
        }

        if (command == 'news')
        {
            request.get('https://yandex.ru', function(err,res,body)
            {
                processContent(function () {
                    return parseYandexNews(body);
                },sendMessage,function (answer) {
                    return bayan_checker.add(hashFnv32a(answer));
                });
            });
        }

        check_stationary_command(command);

        if (command == 'ignore_list')
        {
            sendMessage('Ignored list: ' + ignore_list.showValues(), false);
        }

        if (admins.indexOf(sender) != -1)
        {

            if (command == 'clear_history')
            {
                sendMessage('Баяны очищены!', false);
                bayan_checker.clear();
            }
			

            if (command == 'ignore_add')
            {
                if (checkMinArgsNumber(args, 1))
                {
                    if (!ignore_list.has(args[0]))
                    {
                        ignore_list.add(args[0]);
                        sendMessage('Добавлен игнор ' + args[0], false);
                    }
                    else
                        sendMessage(args[0] +' уже есть в списке игнора!');
                }

            }

            if (command == 'ignore_del')
            {
                if (checkMinArgsNumber(args, 1))
                {
                    if (ignore_list.has(args[0])) {
                        ignore_list.delete(args[0]);
                        sendMessage('Удален игнор ' + args[0], false);
                    }
                    else
                        sendMessage(args[0] +' нет в списке игнора!');
                }
            }

            if (command == 'addcom')
            {
                if (checkMinArgsNumber(args, 1))
                {

                    var com;

                    if (args.length > 1)
                    {
                        //parseForwardedMessagesIds(msg.fwd)
                        com = {message: args.slice(1).join(' ')};
                        sendMessage('Команда ' + args[0] + (stationary_commands.has(args[0]) ? ' изменена!' : ' добавлена!'), false);
                        stationary_commands.add(args[0], com);
                    }
                    else
                    {
                        //var response = vk.api.photos.getById({photos:msg.attach.photo.map((x) => x.get).join(',')}).then((response) => console.log(response));
                        command_queue.push({author:sender,key:args[0]});
                        sendMessage('Команда ' + args[0] + ' ждет назначения следующим сообщением автора', false);
                        //console.log(com);
                    }

                }
            }

            if (command == 'delcom') {
                if (checkMinArgsNumber(args, 1))
                {
                    if (stationary_commands.has(args[0])) {
                        stationary_commands.delete(args[0]);
                        sendMessage('Команда ' + args[0] + ' удалена!', false);
                    }
                    else
                        return sendMessage('Команды ' + args[0] +' нет в списке!');
                }
            }
        }

    }
});

if (process.platform === "win32") {
    var rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on("SIGINT", function () {
        process.emit("SIGINT");
    });
}
process.on("SIGINT", function () {
    saveFiles();
    process.exit();
});