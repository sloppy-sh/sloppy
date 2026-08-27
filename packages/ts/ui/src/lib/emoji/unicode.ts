// Generated. The emoji a shortcode can name, grouped the way the picker shows
// them: shortcodes and search keywords from emojilib (MIT), over the Unicode set
// syr's picker ships. `shortcode` is what `:code:` and `::code::` resolve
// against; `keywords` are search-only aliases and never appear in stored text.

export interface UnicodeEmoji {
	shortcode: string;
	char: string;
	keywords?: readonly string[];
}

export interface UnicodeEmojiCategory {
	name: string;
	emoji: readonly UnicodeEmoji[];
}

export const UNICODE_EMOJI: readonly UnicodeEmojiCategory[] = [
	{
		name: 'Smileys',
		emoji: [
			{
				shortcode: 'grinning_face',
				char: '😀',
				keywords: ['face', 'smile', 'happy', 'joy', 'grin', 'smiley']
			},
			{
				shortcode: 'grinning_face_with_big_eyes',
				char: '😃',
				keywords: [
					'face',
					'happy',
					'joy',
					'haha',
					'smile',
					'funny',
					'mouth',
					'open',
					'smiley',
					'smiling'
				]
			},
			{
				shortcode: 'grinning_face_with_smiling_eyes',
				char: '😄',
				keywords: [
					'face',
					'happy',
					'joy',
					'funny',
					'haha',
					'laugh',
					'like',
					'smile',
					'eye',
					'grin',
					'mouth',
					'open',
					'pleased',
					'smiley'
				]
			},
			{
				shortcode: 'beaming_face_with_smiling_eyes',
				char: '😁',
				keywords: ['face', 'happy', 'smile', 'joy', 'kawaii', 'eye', 'grin', 'grinning']
			},
			{
				shortcode: 'grinning_squinting_face',
				char: '😆',
				keywords: [
					'happy',
					'joy',
					'lol',
					'satisfied',
					'haha',
					'face',
					'glad',
					'xd',
					'laugh',
					'big',
					'closed',
					'eyes',
					'grin',
					'laughing',
					'mouth',
					'open',
					'smile',
					'smiling',
					'tightly'
				]
			},
			{
				shortcode: 'grinning_face_with_sweat',
				char: '😅',
				keywords: [
					'face',
					'hot',
					'happy',
					'laugh',
					'sweat',
					'smile',
					'relief',
					'cold',
					'exercise',
					'mouth',
					'open',
					'smiling'
				]
			},
			{
				shortcode: 'rolling_on_the_floor_laughing',
				char: '🤣',
				keywords: ['face', 'rolling', 'floor', 'laughing', 'lol', 'haha', 'rofl', 'laugh', 'rotfl']
			},
			{
				shortcode: 'face_with_tears_of_joy',
				char: '😂',
				keywords: [
					'face',
					'cry',
					'tears',
					'weep',
					'happy',
					'happytears',
					'haha',
					'crying',
					'laugh',
					'laughing',
					'lol',
					'tear'
				]
			},
			{
				shortcode: 'slightly_smiling_face',
				char: '🙂',
				keywords: ['face', 'smile', 'fine', 'happy', 'this']
			},
			{
				shortcode: 'upside_down_face',
				char: '🙃',
				keywords: ['face', 'flipped', 'silly', 'smile', 'sarcasm']
			},
			{
				shortcode: 'winking_face',
				char: '😉',
				keywords: [
					'face',
					'happy',
					'mischievous',
					'secret',
					'smile',
					'eye',
					'flirt',
					'wink',
					'winky'
				]
			},
			{
				shortcode: 'smiling_face_with_smiling_eyes',
				char: '😊',
				keywords: [
					'face',
					'smile',
					'happy',
					'flushed',
					'crush',
					'embarrassed',
					'shy',
					'joy',
					'blush',
					'eye',
					'proud',
					'smiley'
				]
			},
			{
				shortcode: 'smiling_face_with_halo',
				char: '😇',
				keywords: [
					'face',
					'angel',
					'heaven',
					'halo',
					'innocent',
					'fairy',
					'fantasy',
					'smile',
					'tale'
				]
			},
			{
				shortcode: 'smiling_face_with_hearts',
				char: '🥰',
				keywords: [
					'face',
					'love',
					'like',
					'affection',
					'valentines',
					'infatuation',
					'crush',
					'hearts',
					'adore',
					'eyes',
					'three'
				]
			},
			{
				shortcode: 'smiling_face_with_heart_eyes',
				char: '😍',
				keywords: [
					'face',
					'love',
					'like',
					'affection',
					'valentines',
					'infatuation',
					'crush',
					'heart',
					'eye',
					'shaped',
					'smile'
				]
			},
			{
				shortcode: 'star_struck',
				char: '🤩',
				keywords: ['face', 'smile', 'starry', 'eyes', 'grinning', 'excited', 'eyed', 'wow']
			},
			{
				shortcode: 'face_blowing_a_kiss',
				char: '😘',
				keywords: [
					'face',
					'love',
					'like',
					'affection',
					'valentines',
					'infatuation',
					'kiss',
					'blow',
					'flirt',
					'heart',
					'kissing',
					'throwing'
				]
			},
			{
				shortcode: 'kissing_face',
				char: '😗',
				keywords: [
					'love',
					'like',
					'face',
					'3',
					'valentines',
					'infatuation',
					'kiss',
					'duck',
					'kissy',
					'whistling'
				]
			},
			{
				shortcode: 'kissing_face_with_closed_eyes',
				char: '😚',
				keywords: [
					'face',
					'love',
					'like',
					'affection',
					'valentines',
					'infatuation',
					'kiss',
					'eye',
					'kissy'
				]
			},
			{
				shortcode: 'kissing_face_with_smiling_eyes',
				char: '😙',
				keywords: [
					'face',
					'affection',
					'valentines',
					'infatuation',
					'kiss',
					'eye',
					'kissy',
					'smile',
					'whistle',
					'whistling'
				]
			},
			{
				shortcode: 'smiling_face_with_tear',
				char: '🥲',
				keywords: [
					'sad',
					'cry',
					'pretend',
					'grateful',
					'happy',
					'proud',
					'relieved',
					'smile',
					'touched'
				]
			},
			{
				shortcode: 'face_savoring_food',
				char: '😋',
				keywords: [
					'happy',
					'joy',
					'tongue',
					'smile',
					'face',
					'silly',
					'yummy',
					'nom',
					'delicious',
					'savouring',
					'goofy',
					'hungry',
					'lick',
					'licking',
					'lips',
					'smiling',
					'um',
					'yum'
				]
			},
			{
				shortcode: 'face_with_tongue',
				char: '😛',
				keywords: [
					'face',
					'prank',
					'childish',
					'playful',
					'mischievous',
					'smile',
					'tongue',
					'cheeky',
					'out',
					'stuck'
				]
			},
			{
				shortcode: 'winking_face_with_tongue',
				char: '😜',
				keywords: [
					'face',
					'prank',
					'childish',
					'playful',
					'mischievous',
					'smile',
					'wink',
					'tongue',
					'crazy',
					'eye',
					'joke',
					'out',
					'silly',
					'stuck'
				]
			},
			{
				shortcode: 'zany_face',
				char: '🤪',
				keywords: [
					'face',
					'goofy',
					'crazy',
					'excited',
					'eye',
					'eyes',
					'grinning',
					'large',
					'one',
					'small',
					'wacky',
					'wild'
				]
			},
			{
				shortcode: 'squinting_face_with_tongue',
				char: '😝',
				keywords: [
					'face',
					'prank',
					'playful',
					'mischievous',
					'smile',
					'tongue',
					'closed',
					'eye',
					'eyes',
					'horrible',
					'out',
					'stuck',
					'taste',
					'tightly'
				]
			},
			{
				shortcode: 'money_mouth_face',
				char: '🤑',
				keywords: ['face', 'rich', 'dollar', 'money', 'eyes', 'sign']
			},
			{
				shortcode: 'hugging_face',
				char: '🤗',
				keywords: ['face', 'smile', 'hug', 'hands', 'hugs', 'open', 'smiling']
			},
			{
				shortcode: 'face_with_hand_over_mouth',
				char: '🤭',
				keywords: [
					'face',
					'whoops',
					'shock',
					'surprise',
					'blushing',
					'covering',
					'eyes',
					'quiet',
					'smiling'
				]
			},
			{
				shortcode: 'shushing_face',
				char: '🤫',
				keywords: [
					'face',
					'quiet',
					'shhh',
					'closed',
					'covering',
					'finger',
					'hush',
					'lips',
					'shh',
					'shush',
					'silence'
				]
			},
			{
				shortcode: 'thinking_face',
				char: '🤔',
				keywords: [
					'face',
					'hmmm',
					'think',
					'consider',
					'chin',
					'shade',
					'thinker',
					'throwing',
					'thumb'
				]
			},
			{
				shortcode: 'saluting_face',
				char: '🫡',
				keywords: ['respect', 'salute', 'ok', 'sunny', 'troops', 'yes']
			},
			{
				shortcode: 'zipper_mouth_face',
				char: '🤐',
				keywords: ['face', 'sealed', 'zipper', 'secret', 'hush', 'lips', 'silence', 'zip']
			},
			{
				shortcode: 'face_with_raised_eyebrow',
				char: '🤨',
				keywords: [
					'face',
					'distrust',
					'scepticism',
					'disapproval',
					'disbelief',
					'surprise',
					'suspicious',
					'colbert',
					'mild',
					'one',
					'rock',
					'skeptic'
				]
			},
			{
				shortcode: 'neutral_face',
				char: '😐',
				keywords: ['indifference', 'meh', 'neutral', 'deadpan', 'faced', 'mouth', 'straight']
			},
			{
				shortcode: 'expressionless_face',
				char: '😑',
				keywords: [
					'face',
					'indifferent',
					'-_-',
					'meh',
					'deadpan',
					'inexpressive',
					'mouth',
					'straight',
					'unexpressive'
				]
			},
			{
				shortcode: 'face_without_mouth',
				char: '😶',
				keywords: ['face', 'blank', 'mouthless', 'mute', 'no', 'quiet', 'silence', 'silent']
			},
			{
				shortcode: 'dotted_line_face',
				char: '🫥',
				keywords: [
					'invisible',
					'lonely',
					'isolation',
					'depression',
					'depressed',
					'disappear',
					'hide',
					'introvert'
				]
			},
			{
				shortcode: 'smirking_face',
				char: '😏',
				keywords: [
					'face',
					'smile',
					'mean',
					'prank',
					'smug',
					'sarcasm',
					'flirting',
					'sexual',
					'smirk',
					'suggestive'
				]
			},
			{
				shortcode: 'unamused_face',
				char: '😒',
				keywords: [
					'indifference',
					'bored',
					'serious',
					'sarcasm',
					'unimpressed',
					'skeptical',
					'dubious',
					'ugh',
					'side_eye',
					'dissatisfied',
					'meh',
					'unhappy'
				]
			},
			{
				shortcode: 'face_with_rolling_eyes',
				char: '🙄',
				keywords: ['face', 'eyeroll', 'frustrated', 'eye', 'roll']
			},
			{
				shortcode: 'grimacing_face',
				char: '😬',
				keywords: ['face', 'grimace', 'teeth', 'awkward', 'eek', 'nervous']
			},
			{
				shortcode: 'lying_face',
				char: '🤥',
				keywords: ['face', 'lie', 'pinocchio', 'liar', 'long', 'nose']
			},
			{
				shortcode: 'relieved_face',
				char: '😌',
				keywords: ['face', 'relaxed', 'phew', 'massage', 'happiness', 'content', 'pleased', 'whew']
			},
			{
				shortcode: 'pensive_face',
				char: '😔',
				keywords: ['face', 'sad', 'depressed', 'upset', 'dejected', 'sadface', 'sorrowful']
			},
			{
				shortcode: 'sleepy_face',
				char: '😪',
				keywords: ['face', 'tired', 'rest', 'nap', 'bubble', 'side', 'sleep', 'snot', 'tear']
			},
			{ shortcode: 'drooling_face', char: '🤤', keywords: ['face', 'drool'] },
			{
				shortcode: 'sleeping_face',
				char: '😴',
				keywords: ['face', 'tired', 'sleepy', 'night', 'zzz', 'sleep', 'snoring']
			},
			{
				shortcode: 'face_with_medical_mask',
				char: '😷',
				keywords: [
					'face',
					'sick',
					'ill',
					'disease',
					'covid',
					'cold',
					'coronavirus',
					'doctor',
					'medicine',
					'surgical'
				]
			},
			{
				shortcode: 'face_with_thermometer',
				char: '🤒',
				keywords: ['sick', 'temperature', 'thermometer', 'cold', 'fever', 'covid', 'ill']
			},
			{
				shortcode: 'face_with_head_bandage',
				char: '🤕',
				keywords: ['injured', 'clumsy', 'bandage', 'hurt', 'bandaged', 'injury']
			},
			{
				shortcode: 'nauseated_face',
				char: '🤢',
				keywords: ['face', 'vomit', 'gross', 'green', 'sick', 'ill', 'barf', 'disgust', 'disgusted']
			},
			{
				shortcode: 'face_vomiting',
				char: '🤮',
				keywords: [
					'face',
					'sick',
					'barf',
					'ill',
					'mouth',
					'open',
					'puke',
					'spew',
					'throwing',
					'up',
					'vomit'
				]
			},
			{
				shortcode: 'woozy_face',
				char: '🥴',
				keywords: [
					'face',
					'dizzy',
					'intoxicated',
					'tipsy',
					'wavy',
					'drunk',
					'eyes',
					'groggy',
					'mouth',
					'uneven'
				]
			},
			{
				shortcode: 'dizzy_face',
				char: '😵',
				keywords: [
					'spent',
					'unconscious',
					'xox',
					'dizzy',
					'cross',
					'crossed',
					'dead',
					'eyes',
					'knocked',
					'out'
				]
			},
			{
				shortcode: 'exploding_head',
				char: '🤯',
				keywords: ['face', 'shocked', 'mind', 'blown', 'blowing', 'explosion', 'mad']
			},
			{
				shortcode: 'partying_face',
				char: '🥳',
				keywords: ['face', 'celebration', 'woohoo', 'birthday', 'hat', 'horn', 'party']
			},
			{
				shortcode: 'disguised_face',
				char: '🥸',
				keywords: ['pretent', 'brows', 'glasses', 'moustache', 'disguise', 'incognito', 'nose']
			},
			{
				shortcode: 'smiling_face_with_sunglasses',
				char: '😎',
				keywords: [
					'face',
					'cool',
					'smile',
					'summer',
					'beach',
					'sunglass',
					'best',
					'bright',
					'eye',
					'eyewear',
					'friends',
					'glasses',
					'mutual',
					'snapchat',
					'sun',
					'weather'
				]
			},
			{
				shortcode: 'nerd_face',
				char: '🤓',
				keywords: ['face', 'nerdy', 'geek', 'dork', 'glasses', 'smiling']
			},
			{
				shortcode: 'face_with_steam_from_nose',
				char: '😤',
				keywords: [
					'face',
					'gas',
					'phew',
					'proud',
					'pride',
					'triumph',
					'airing',
					'frustrated',
					'grievances',
					'look',
					'mad',
					'smug',
					'steaming',
					'won'
				]
			},
			{
				shortcode: 'angry_face',
				char: '😠',
				keywords: ['mad', 'face', 'annoyed', 'frustrated', 'anger', 'grumpy']
			},
			{
				shortcode: 'pouting_face',
				char: '😡',
				keywords: ['angry', 'mad', 'hate', 'despise', 'enraged', 'grumpy', 'pout', 'rage', 'red']
			},
			{
				shortcode: 'face_with_symbols_on_mouth',
				char: '🤬',
				keywords: [
					'face',
					'swearing',
					'cursing',
					'cussing',
					'profanity',
					'expletive',
					'covering',
					'foul',
					'grawlix',
					'over',
					'serious'
				]
			},
			{
				shortcode: 'smiling_face_with_horns',
				char: '😈',
				keywords: [
					'devil',
					'horns',
					'evil',
					'fairy',
					'fantasy',
					'happy',
					'imp',
					'purple',
					'smile',
					'tale'
				]
			},
			{
				shortcode: 'angry_face_with_horns',
				char: '👿',
				keywords: [
					'devil',
					'angry',
					'horns',
					'demon',
					'evil',
					'fairy',
					'fantasy',
					'goblin',
					'imp',
					'purple',
					'sad',
					'tale'
				]
			},
			{
				shortcode: 'skull',
				char: '💀',
				keywords: [
					'dead',
					'skeleton',
					'creepy',
					'death',
					'body',
					'danger',
					'face',
					'fairy',
					'grey',
					'halloween',
					'monster',
					'poison',
					'tale'
				]
			},
			{
				shortcode: 'skull_and_crossbones',
				char: '☠️',
				keywords: [
					'poison',
					'danger',
					'deadly',
					'scary',
					'death',
					'pirate',
					'evil',
					'body',
					'face',
					'halloween',
					'monster'
				]
			},
			{
				shortcode: 'pile_of_poo',
				char: '💩',
				keywords: [
					'hankey',
					'shitface',
					'fail',
					'turd',
					'shit',
					'comic',
					'crap',
					'dirt',
					'dog',
					'dung',
					'face',
					'monster',
					'poop',
					'smiling',
					'bad',
					'needs_improvement'
				]
			},
			{ shortcode: 'clown_face', char: '🤡', keywords: ['face', 'mock'] },
			{
				shortcode: 'ogre',
				char: '👹',
				keywords: [
					'monster',
					'red',
					'mask',
					'halloween',
					'scary',
					'creepy',
					'devil',
					'demon',
					'japanese_ogre',
					'creature',
					'face',
					'fairy',
					'fantasy',
					'oni',
					'tale',
					'shrek'
				]
			},
			{
				shortcode: 'goblin',
				char: '👺',
				keywords: [
					'red',
					'evil',
					'mask',
					'monster',
					'scary',
					'creepy',
					'japanese_goblin',
					'creature',
					'face',
					'fairy',
					'fantasy',
					'long',
					'nose',
					'tale',
					'tengu'
				]
			},
			{
				shortcode: 'ghost',
				char: '👻',
				keywords: [
					'halloween',
					'spooky',
					'scary',
					'creature',
					'disappear',
					'face',
					'fairy',
					'fantasy',
					'ghoul',
					'monster',
					'tale'
				]
			},
			{
				shortcode: 'alien',
				char: '👽',
				keywords: [
					'ufo',
					'paul',
					'weird',
					'outer_space',
					'creature',
					'et',
					'extraterrestrial',
					'face',
					'fairy',
					'fantasy',
					'monster',
					'tale',
					'external'
				]
			},
			{
				shortcode: 'alien_monster',
				char: '👾',
				keywords: [
					'game',
					'arcade',
					'play',
					'creature',
					'extraterrestrial',
					'face',
					'fairy',
					'fantasy',
					'invader',
					'retro',
					'space',
					'tale',
					'ufo',
					'video'
				]
			},
			{
				shortcode: 'robot',
				char: '🤖',
				keywords: ['computer', 'machine', 'bot', 'face', 'monster']
			}
		]
	},
	{
		name: 'Hands',
		emoji: [
			{
				shortcode: 'waving_hand',
				char: '👋',
				keywords: [
					'wave',
					'hands',
					'gesture',
					'goodbye',
					'solong',
					'farewell',
					'hello',
					'hi',
					'palm',
					'body',
					'sign'
				]
			},
			{
				shortcode: 'raised_back_of_hand',
				char: '🤚',
				keywords: ['fingers', 'raised', 'backhand', 'body']
			},
			{
				shortcode: 'hand_with_fingers_splayed',
				char: '🖐️',
				keywords: ['hand', 'fingers', 'palm', 'body', 'finger', 'five', 'raised']
			},
			{
				shortcode: 'raised_hand',
				char: '✋',
				keywords: ['fingers', 'stop', 'highfive', 'palm', 'ban', 'body', 'five', 'high']
			},
			{
				shortcode: 'vulcan_salute',
				char: '🖖',
				keywords: [
					'hand',
					'fingers',
					'spock',
					'between',
					'body',
					'finger',
					'middle',
					'part',
					'prosper',
					'raised',
					'ring',
					'split'
				]
			},
			{
				shortcode: 'rightwards_hand',
				char: '🫱',
				keywords: ['palm', 'offer', 'right', 'rightward']
			},
			{ shortcode: 'leftwards_hand', char: '🫲', keywords: ['palm', 'offer', 'left', 'leftward'] },
			{ shortcode: 'palm_down_hand', char: '🫳', keywords: ['palm', 'drop', 'dismiss', 'shoo'] },
			{
				shortcode: 'palm_up_hand',
				char: '🫴',
				keywords: ['lift', 'offer', 'demand', 'beckon', 'catch', 'come']
			},
			{
				shortcode: 'leftwards_pushing_hand',
				char: '🫷',
				keywords: ['highfive', 'pressing', 'stop']
			},
			{
				shortcode: 'rightwards_pushing_hand',
				char: '🫸',
				keywords: ['highfive', 'pressing', 'stop']
			},
			{
				shortcode: 'ok_hand',
				char: '👌',
				keywords: ['fingers', 'limbs', 'perfect', 'ok', 'okay', 'body', 'sign']
			},
			{
				shortcode: 'pinched_fingers',
				char: '🤌',
				keywords: [
					'size',
					'tiny',
					'small',
					'che',
					'finger',
					'gesture',
					'hand',
					'interrogation',
					'ma',
					'purse',
					'sarcastic',
					'vuoi'
				]
			},
			{
				shortcode: 'pinching_hand',
				char: '🤏',
				keywords: ['tiny', 'small', 'size', 'amount', 'body', 'little']
			},
			{
				shortcode: 'victory_hand',
				char: '✌️',
				keywords: [
					'fingers',
					'ohyeah',
					'hand',
					'peace',
					'victory',
					'two',
					'air',
					'body',
					'quotes',
					'sign',
					'v'
				]
			},
			{
				shortcode: 'crossed_fingers',
				char: '🤞',
				keywords: [
					'good',
					'lucky',
					'body',
					'cross',
					'finger',
					'hand',
					'hopeful',
					'index',
					'luck',
					'middle'
				]
			},
			{
				shortcode: 'hand_with_index_finger_and_thumb_crossed',
				char: '🫰',
				keywords: ['heart', 'love', 'money', 'expensive', 'snap']
			},
			{
				shortcode: 'love_you_gesture',
				char: '🤟',
				keywords: ['hand', 'fingers', 'gesture', 'body', 'i', 'ily', 'sign']
			},
			{
				shortcode: 'sign_of_the_horns',
				char: '🤘',
				keywords: [
					'hand',
					'fingers',
					'evil_eye',
					'sign_of_horns',
					'rock_on',
					'body',
					'devil',
					'finger',
					'heavy',
					'metal'
				]
			},
			{
				shortcode: 'call_me_hand',
				char: '🤙',
				keywords: ['hands', 'gesture', 'shaka', 'body', 'phone', 'sign']
			},
			{
				shortcode: 'backhand_index_pointing_left',
				char: '👈',
				keywords: ['direction', 'fingers', 'hand', 'left', 'body', 'finger', 'point', 'white']
			},
			{
				shortcode: 'backhand_index_pointing_right',
				char: '👉',
				keywords: ['fingers', 'hand', 'direction', 'right', 'body', 'finger', 'point', 'white']
			},
			{
				shortcode: 'backhand_index_pointing_up',
				char: '👆',
				keywords: [
					'fingers',
					'hand',
					'direction',
					'up',
					'body',
					'finger',
					'middle',
					'point',
					'white'
				]
			},
			{
				shortcode: 'middle_finger',
				char: '🖕',
				keywords: [
					'hand',
					'fingers',
					'rude',
					'middle',
					'flipping',
					'bird',
					'body',
					'dito',
					'extended',
					'fu',
					'medio',
					'reversed'
				]
			},
			{
				shortcode: 'backhand_index_pointing_down',
				char: '👇',
				keywords: ['fingers', 'hand', 'direction', 'down', 'body', 'finger', 'point', 'white']
			},
			{
				shortcode: 'index_pointing_up',
				char: '☝️',
				keywords: [
					'hand',
					'fingers',
					'direction',
					'up',
					'body',
					'finger',
					'point',
					'secret',
					'white'
				]
			},
			{
				shortcode: 'index_pointing_at_the_viewer',
				char: '🫵',
				keywords: ['you', 'recruit', 'point']
			},
			{
				shortcode: 'thumbs_up',
				char: '👍',
				keywords: [
					'thumbsup',
					'yes',
					'awesome',
					'good',
					'agree',
					'accept',
					'cool',
					'hand',
					'like',
					'+1',
					'approve',
					'body',
					'ok',
					'sign',
					'thumb'
				]
			},
			{
				shortcode: 'thumbs_down',
				char: '👎',
				keywords: [
					'thumbsdown',
					'no',
					'dislike',
					'hand',
					'-1',
					'bad',
					'body',
					'bury',
					'disapprove',
					'sign',
					'thumb'
				]
			},
			{
				shortcode: 'raised_fist',
				char: '✊',
				keywords: ['fingers', 'hand', 'grasp', 'body', 'clenched', 'power', 'pump', 'punch']
			},
			{
				shortcode: 'oncoming_fist',
				char: '👊',
				keywords: [
					'angry',
					'violence',
					'fist',
					'hit',
					'attack',
					'hand',
					'body',
					'bro',
					'brofist',
					'bump',
					'clenched',
					'closed',
					'facepunch',
					'fisted',
					'punch',
					'sign'
				]
			},
			{
				shortcode: 'left_facing_fist',
				char: '🤛',
				keywords: ['hand', 'fistbump', 'body', 'bump', 'leftwards']
			},
			{
				shortcode: 'right_facing_fist',
				char: '🤜',
				keywords: ['hand', 'fistbump', 'body', 'bump', 'rightwards']
			},
			{
				shortcode: 'clapping_hands',
				char: '👏',
				keywords: [
					'hands',
					'praise',
					'applause',
					'congrats',
					'yay',
					'body',
					'clap',
					'golf',
					'hand',
					'round',
					'sign'
				]
			},
			{
				shortcode: 'raising_hands',
				char: '🙌',
				keywords: [
					'gesture',
					'hooray',
					'yea',
					'celebration',
					'hands',
					'air',
					'arms',
					'banzai',
					'body',
					'both',
					'festivus',
					'hallelujah',
					'hand',
					'miracle',
					'person',
					'praise',
					'raised',
					'two'
				]
			},
			{ shortcode: 'heart_hands', char: '🫶', keywords: ['love', 'appreciation', 'support'] },
			{
				shortcode: 'open_hands',
				char: '👐',
				keywords: ['fingers', 'butterfly', 'hands', 'open', 'body', 'hand', 'hug', 'jazz', 'sign']
			},
			{
				shortcode: 'palms_up_together',
				char: '🤲',
				keywords: ['hands', 'gesture', 'cupped', 'prayer', 'body', 'dua', 'facing']
			},
			{
				shortcode: 'handshake',
				char: '🤝',
				keywords: ['agreement', 'shake', 'deal', 'hand', 'hands', 'meeting', 'shaking']
			},
			{
				shortcode: 'folded_hands',
				char: '🙏',
				keywords: [
					'please',
					'hope',
					'wish',
					'namaste',
					'highfive',
					'pray',
					'thanks',
					'appreciate',
					'ask',
					'body',
					'bow',
					'five',
					'gesture',
					'hand',
					'high',
					'person',
					'prayer',
					'pressed',
					'together'
				]
			}
		]
	},
	{
		name: 'Hearts',
		emoji: [
			{
				shortcode: 'red_heart',
				char: '❤️',
				keywords: ['love', 'like', 'valentines', 'black', 'heavy']
			},
			{
				shortcode: 'orange_heart',
				char: '🧡',
				keywords: ['love', 'like', 'affection', 'valentines']
			},
			{
				shortcode: 'yellow_heart',
				char: '💛',
				keywords: ['love', 'like', 'affection', 'valentines', 'bf', 'gold', 'snapchat']
			},
			{
				shortcode: 'green_heart',
				char: '💚',
				keywords: ['love', 'like', 'affection', 'valentines', 'nct']
			},
			{
				shortcode: 'blue_heart',
				char: '💙',
				keywords: ['love', 'like', 'affection', 'valentines', 'brand', 'neutral']
			},
			{
				shortcode: 'purple_heart',
				char: '💜',
				keywords: ['love', 'like', 'affection', 'valentines', 'bts', 'emoji']
			},
			{ shortcode: 'black_heart', char: '🖤', keywords: ['evil', 'dark', 'wicked'] },
			{ shortcode: 'white_heart', char: '🤍', keywords: ['pure'] },
			{ shortcode: 'brown_heart', char: '🤎', keywords: ['coffee'] },
			{
				shortcode: 'broken_heart',
				char: '💔',
				keywords: ['sad', 'sorry', 'break', 'heart', 'heartbreak', 'breaking', 'brokenhearted']
			},
			{
				shortcode: 'heart_on_fire',
				char: '❤️‍🔥',
				keywords: ['passionate', 'enthusiastic', 'burn', 'love', 'lust', 'sacred']
			},
			{
				shortcode: 'mending_heart',
				char: '❤️‍🩹',
				keywords: [
					'bandage',
					'wounded',
					'bandaged',
					'healing',
					'healthier',
					'improving',
					'recovering',
					'recuperating',
					'unbroken',
					'well'
				]
			},
			{
				shortcode: 'heart_exclamation',
				char: '❣️',
				keywords: [
					'decoration',
					'love',
					'above',
					'an',
					'as',
					'dot',
					'heavy',
					'mark',
					'ornament',
					'punctuation',
					'red'
				]
			},
			{
				shortcode: 'two_hearts',
				char: '💕',
				keywords: ['love', 'like', 'affection', 'valentines', 'heart', 'pink', 'small']
			},
			{
				shortcode: 'revolving_hearts',
				char: '💞',
				keywords: ['love', 'like', 'affection', 'valentines', 'heart', 'two']
			},
			{
				shortcode: 'beating_heart',
				char: '💓',
				keywords: [
					'love',
					'like',
					'affection',
					'valentines',
					'pink',
					'heart',
					'alarm',
					'heartbeat',
					'pulsating',
					'wifi'
				]
			},
			{
				shortcode: 'growing_heart',
				char: '💗',
				keywords: [
					'like',
					'love',
					'affection',
					'valentines',
					'pink',
					'excited',
					'heartpulse',
					'multiple',
					'nervous',
					'pulse',
					'triple'
				]
			},
			{
				shortcode: 'sparkling_heart',
				char: '💖',
				keywords: ['love', 'like', 'affection', 'valentines', 'excited', 'sparkle', 'sparkly']
			},
			{
				shortcode: 'heart_with_arrow',
				char: '💘',
				keywords: [
					'love',
					'like',
					'heart',
					'affection',
					'valentines',
					'cupid',
					'lovestruck',
					'romance'
				]
			},
			{
				shortcode: 'heart_with_ribbon',
				char: '💝',
				keywords: ['love', 'valentines', 'box', 'chocolate', 'chocolates', 'gift', 'valentine']
			},
			{ shortcode: 'heart_decoration', char: '💟', keywords: ['purple-square', 'love', 'like'] },
			{
				shortcode: 'heart_suit',
				char: '♥️',
				keywords: ['poker', 'cards', 'magic', 'suits', 'black', 'card', 'game', 'hearts']
			},
			{ shortcode: 'pink_heart', char: '🩷', keywords: ['valentines'] },
			{ shortcode: 'light_blue_heart', char: '🩵', keywords: ['ice'] },
			{ shortcode: 'grey_heart', char: '🩶', keywords: ['silver', 'monochrome'] }
		]
	},
	{
		name: 'Nature',
		emoji: [
			{
				shortcode: 'dog_face',
				char: '🐶',
				keywords: ['animal', 'friend', 'nature', 'woof', 'puppy', 'pet', 'faithful']
			},
			{
				shortcode: 'cat_face',
				char: '🐱',
				keywords: ['animal', 'meow', 'nature', 'pet', 'kitten', 'kitty']
			},
			{
				shortcode: 'mouse_face',
				char: '🐭',
				keywords: ['animal', 'nature', 'cheese_wedge', 'rodent']
			},
			{ shortcode: 'hamster', char: '🐹', keywords: ['animal', 'nature', 'face', 'pet'] },
			{
				shortcode: 'rabbit_face',
				char: '🐰',
				keywords: ['animal', 'nature', 'pet', 'spring', 'magic', 'bunny', 'easter']
			},
			{ shortcode: 'fox', char: '🦊', keywords: ['animal', 'nature', 'face'] },
			{ shortcode: 'bear', char: '🐻', keywords: ['animal', 'nature', 'wild', 'face', 'teddy'] },
			{ shortcode: 'panda', char: '🐼', keywords: ['animal', 'nature', 'face'] },
			{
				shortcode: 'koala',
				char: '🐨',
				keywords: ['animal', 'nature', 'bear', 'face', 'marsupial']
			},
			{
				shortcode: 'tiger_face',
				char: '🐯',
				keywords: ['animal', 'cat', 'danger', 'wild', 'nature', 'roar', 'cute']
			},
			{ shortcode: 'lion', char: '🦁', keywords: ['animal', 'nature', 'face', 'leo', 'zodiac'] },
			{
				shortcode: 'cow_face',
				char: '🐮',
				keywords: ['beef', 'ox', 'animal', 'nature', 'moo', 'milk', 'happy']
			},
			{ shortcode: 'pig_face', char: '🐷', keywords: ['animal', 'oink', 'nature', 'head'] },
			{ shortcode: 'frog', char: '🐸', keywords: ['animal', 'nature', 'croak', 'toad', 'face'] },
			{ shortcode: 'monkey_face', char: '🐵', keywords: ['animal', 'nature', 'circus', 'head'] },
			{ shortcode: 'chicken', char: '🐔', keywords: ['animal', 'cluck', 'nature', 'bird', 'hen'] },
			{ shortcode: 'penguin', char: '🐧', keywords: ['animal', 'nature', 'bird'] },
			{ shortcode: 'bird', char: '🐦', keywords: ['animal', 'nature', 'fly', 'tweet', 'spring'] },
			{ shortcode: 'duck', char: '🦆', keywords: ['animal', 'nature', 'bird', 'mallard'] },
			{ shortcode: 'eagle', char: '🦅', keywords: ['animal', 'nature', 'bird', 'bald'] },
			{ shortcode: 'owl', char: '🦉', keywords: ['animal', 'nature', 'bird', 'hoot', 'wise'] },
			{ shortcode: 'wolf', char: '🐺', keywords: ['animal', 'nature', 'wild', 'face'] },
			{ shortcode: 'boar', char: '🐗', keywords: ['animal', 'nature', 'pig', 'warthog', 'wild'] },
			{ shortcode: 'horse_face', char: '🐴', keywords: ['animal', 'brown', 'nature', 'head'] },
			{ shortcode: 'unicorn', char: '🦄', keywords: ['animal', 'nature', 'mystical', 'face'] },
			{
				shortcode: 'honeybee',
				char: '🐝',
				keywords: ['animal', 'insect', 'nature', 'bug', 'spring', 'honey', 'bee', 'bumblebee']
			},
			{
				shortcode: 'bug',
				char: '🐛',
				keywords: ['animal', 'insect', 'nature', 'worm', 'caterpillar']
			},
			{
				shortcode: 'butterfly',
				char: '🦋',
				keywords: ['animal', 'insect', 'nature', 'caterpillar', 'pretty']
			},
			{ shortcode: 'snail', char: '🐌', keywords: ['slow', 'animal', 'shell', 'garden', 'slug'] },
			{
				shortcode: 'lady_beetle',
				char: '🐞',
				keywords: ['animal', 'insect', 'nature', 'ladybug', 'bug', 'ladybird']
			},
			{
				shortcode: 'cherry_blossom',
				char: '🌸',
				keywords: ['nature', 'plant', 'spring', 'flower', 'pink', 'sakura']
			},
			{
				shortcode: 'white_flower',
				char: '💮',
				keywords: [
					'japanese',
					'spring',
					'blossom',
					'cherry',
					'doily',
					'done',
					'paper',
					'stamp',
					'well'
				]
			},
			{
				shortcode: 'rose',
				char: '🌹',
				keywords: ['flowers', 'valentines', 'love', 'spring', 'flower', 'plant', 'red']
			},
			{
				shortcode: 'wilted_flower',
				char: '🥀',
				keywords: ['plant', 'nature', 'flower', 'rose', 'dead', 'drooping']
			},
			{
				shortcode: 'hibiscus',
				char: '🌺',
				keywords: ['plant', 'vegetable', 'flowers', 'beach', 'flower']
			},
			{
				shortcode: 'sunflower',
				char: '🌻',
				keywords: ['nature', 'plant', 'fall', 'flower', 'sun', 'yellow']
			},
			{
				shortcode: 'blossom',
				char: '🌼',
				keywords: ['nature', 'flowers', 'yellow', 'daisy', 'flower', 'plant']
			},
			{
				shortcode: 'tulip',
				char: '🌷',
				keywords: ['flowers', 'plant', 'nature', 'summer', 'spring', 'flower']
			},
			{
				shortcode: 'seedling',
				char: '🌱',
				keywords: [
					'plant',
					'nature',
					'grass',
					'lawn',
					'spring',
					'sprout',
					'sprouting',
					'young',
					'seed'
				]
			},
			{
				shortcode: 'evergreen_tree',
				char: '🌲',
				keywords: ['plant', 'nature', 'fir', 'pine', 'wood']
			},
			{
				shortcode: 'deciduous_tree',
				char: '🌳',
				keywords: ['plant', 'nature', 'rounded', 'shedding', 'wood']
			},
			{
				shortcode: 'palm_tree',
				char: '🌴',
				keywords: [
					'plant',
					'vegetable',
					'nature',
					'summer',
					'beach',
					'mojito',
					'tropical',
					'coconut'
				]
			},
			{ shortcode: 'cactus', char: '🌵', keywords: ['vegetable', 'plant', 'nature', 'desert'] },
			{
				shortcode: 'four_leaf_clover',
				char: '🍀',
				keywords: ['vegetable', 'plant', 'nature', 'lucky', 'irish', 'ireland', 'luck']
			},
			{
				shortcode: 'maple_leaf',
				char: '🍁',
				keywords: ['nature', 'plant', 'vegetable', 'ca', 'fall', 'canada', 'canadian', 'falling']
			},
			{
				shortcode: 'fallen_leaf',
				char: '🍂',
				keywords: ['nature', 'plant', 'vegetable', 'leaves', 'autumn', 'brown', 'fall', 'falling']
			},
			{
				shortcode: 'leaf_fluttering_in_wind',
				char: '🍃',
				keywords: [
					'nature',
					'plant',
					'tree',
					'vegetable',
					'grass',
					'lawn',
					'spring',
					'blow',
					'flutter',
					'green',
					'leaves'
				]
			},
			{
				shortcode: 'globe_showing_europe_africa',
				char: '🌍',
				keywords: ['globe', 'world', 'earth', 'international', 'planet']
			},
			{
				shortcode: 'crescent_moon',
				char: '🌙',
				keywords: ['night', 'sleep', 'sky', 'evening', 'magic', 'space', 'weather']
			},
			{ shortcode: 'star', char: '⭐', keywords: ['night', 'yellow', 'gold', 'medium', 'white'] },
			{
				shortcode: 'rainbow',
				char: '🌈',
				keywords: [
					'nature',
					'happy',
					'unicorn_face',
					'photo',
					'sky',
					'spring',
					'gay',
					'lgbt',
					'pride',
					'primary',
					'rain',
					'weather'
				]
			},
			{
				shortcode: 'sun',
				char: '☀️',
				keywords: [
					'weather',
					'nature',
					'brightness',
					'summer',
					'beach',
					'spring',
					'black',
					'bright',
					'rays',
					'space',
					'sunny',
					'sunshine'
				]
			},
			{
				shortcode: 'sun_behind_cloud',
				char: '⛅',
				keywords: ['weather', 'nature', 'cloudy', 'morning', 'fall', 'spring', 'partly', 'sunny']
			},
			{ shortcode: 'cloud', char: '☁️', keywords: ['weather', 'sky', 'cloudy', 'overcast'] },
			{ shortcode: 'cloud_with_rain', char: '🌧️', keywords: ['weather'] },
			{
				shortcode: 'cloud_with_lightning_and_rain',
				char: '⛈️',
				keywords: ['weather', 'lightning', 'thunder']
			},
			{
				shortcode: 'snowflake',
				char: '❄️',
				keywords: ['winter', 'season', 'cold', 'weather', 'christmas', 'xmas', 'snow', 'snowing']
			},
			{
				shortcode: 'fire',
				char: '🔥',
				keywords: ['hot', 'cook', 'flame', 'burn', 'lit', 'snapstreak', 'tool', 'remove']
			},
			{
				shortcode: 'droplet',
				char: '💧',
				keywords: ['water', 'drip', 'faucet', 'spring', 'cold', 'comic', 'drop', 'sweat', 'weather']
			},
			{
				shortcode: 'water_wave',
				char: '🌊',
				keywords: [
					'sea',
					'water',
					'wave',
					'nature',
					'tsunami',
					'disaster',
					'beach',
					'ocean',
					'waves',
					'weather'
				]
			}
		]
	},
	{
		name: 'Food',
		emoji: [
			{
				shortcode: 'red_apple',
				char: '🍎',
				keywords: ['fruit', 'mac', 'school', 'delicious', 'plant']
			},
			{ shortcode: 'pear', char: '🍐', keywords: ['fruit', 'nature', 'food', 'plant'] },
			{
				shortcode: 'tangerine',
				char: '🍊',
				keywords: ['food', 'fruit', 'nature', 'orange', 'mandarin', 'plant']
			},
			{
				shortcode: 'lemon',
				char: '🍋',
				keywords: ['fruit', 'nature', 'citrus', 'lemonade', 'plant']
			},
			{
				shortcode: 'banana',
				char: '🍌',
				keywords: ['fruit', 'food', 'monkey', 'plant', 'plantain']
			},
			{
				shortcode: 'watermelon',
				char: '🍉',
				keywords: ['fruit', 'food', 'picnic', 'summer', 'plant']
			},
			{ shortcode: 'grapes', char: '🍇', keywords: ['fruit', 'food', 'wine', 'grape', 'plant'] },
			{
				shortcode: 'strawberry',
				char: '🍓',
				keywords: ['fruit', 'food', 'nature', 'berry', 'plant']
			},
			{
				shortcode: 'blueberries',
				char: '🫐',
				keywords: ['fruit', 'berry', 'bilberry', 'blue', 'blueberry']
			},
			{
				shortcode: 'melon',
				char: '🍈',
				keywords: ['fruit', 'nature', 'food', 'cantaloupe', 'honeydew', 'muskmelon', 'plant']
			},
			{
				shortcode: 'cherries',
				char: '🍒',
				keywords: ['food', 'fruit', 'berries', 'cherry', 'plant', 'red', 'wild']
			},
			{
				shortcode: 'peach',
				char: '🍑',
				keywords: ['fruit', 'nature', 'food', 'bottom', 'butt', 'plant']
			},
			{ shortcode: 'mango', char: '🥭', keywords: ['fruit', 'food', 'tropical'] },
			{ shortcode: 'pineapple', char: '🍍', keywords: ['fruit', 'nature', 'food', 'plant'] },
			{
				shortcode: 'coconut',
				char: '🥥',
				keywords: ['fruit', 'nature', 'food', 'palm', 'cocoanut', 'colada']
			},
			{
				shortcode: 'kiwi_fruit',
				char: '🥝',
				keywords: ['fruit', 'food', 'chinese', 'gooseberry', 'kiwifruit']
			},
			{
				shortcode: 'tomato',
				char: '🍅',
				keywords: ['fruit', 'vegetable', 'nature', 'food', 'plant']
			},
			{ shortcode: 'avocado', char: '🥑', keywords: ['fruit', 'food'] },
			{
				shortcode: 'pizza',
				char: '🍕',
				keywords: ['food', 'party', 'italy', 'cheese', 'pepperoni', 'slice']
			},
			{
				shortcode: 'hamburger',
				char: '🍔',
				keywords: ['meat', 'beef', 'cheeseburger', 'mcdonalds']
			},
			{ shortcode: 'french_fries', char: '🍟', keywords: ['chips', 'snack', 'potato'] },
			{
				shortcode: 'hot_dog',
				char: '🌭',
				keywords: ['food', 'frankfurter', 'america', 'hotdog', 'redhot', 'sausage', 'wiener']
			},
			{
				shortcode: 'popcorn',
				char: '🍿',
				keywords: ['food', 'films', 'snack', 'drama', 'corn', 'popping']
			},
			{ shortcode: 'salt', char: '🧂', keywords: ['condiment', 'shaker'] },
			{ shortcode: 'egg', char: '🥚', keywords: ['food', 'chicken', 'breakfast', 'easter_egg'] },
			{
				shortcode: 'cooking',
				char: '🍳',
				keywords: ['food', 'breakfast', 'kitchen', 'egg', 'skillet', 'fried', 'frying', 'pan']
			},
			{
				shortcode: 'waffle',
				char: '🧇',
				keywords: ['food', 'breakfast', 'brunch', 'indecisive', 'iron']
			},
			{
				shortcode: 'pancakes',
				char: '🥞',
				keywords: ['food', 'breakfast', 'flapjacks', 'hotcakes', 'brunch', 'hotcake', 'pancake']
			},
			{ shortcode: 'bread', char: '🍞', keywords: ['food', 'wheat', 'breakfast', 'toast', 'loaf'] },
			{
				shortcode: 'croissant',
				char: '🥐',
				keywords: ['food', 'bread', 'french', 'breakfast', 'crescent', 'roll']
			},
			{
				shortcode: 'shortcake',
				char: '🍰',
				keywords: ['food', 'dessert', 'cake', 'pastry', 'piece', 'slice', 'strawberry', 'sweet']
			},
			{
				shortcode: 'birthday_cake',
				char: '🎂',
				keywords: ['food', 'dessert', 'cake', 'candles', 'celebration', 'party', 'pastry', 'sweet']
			},
			{
				shortcode: 'cupcake',
				char: '🧁',
				keywords: ['food', 'dessert', 'bakery', 'sweet', 'cake', 'fairy', 'pastry']
			},
			{
				shortcode: 'doughnut',
				char: '🍩',
				keywords: ['food', 'dessert', 'snack', 'sweet', 'donut', 'breakfast']
			},
			{
				shortcode: 'cookie',
				char: '🍪',
				keywords: ['food', 'snack', 'oreo', 'chocolate', 'sweet', 'dessert', 'biscuit', 'chip']
			},
			{
				shortcode: 'chocolate_bar',
				char: '🍫',
				keywords: ['food', 'snack', 'dessert', 'sweet', 'candy']
			},
			{ shortcode: 'candy', char: '🍬', keywords: ['snack', 'dessert', 'sweet', 'lolly'] },
			{
				shortcode: 'lollipop',
				char: '🍭',
				keywords: ['food', 'snack', 'candy', 'sweet', 'dessert', 'lollypop', 'sucker']
			},
			{
				shortcode: 'hot_beverage',
				char: '☕',
				keywords: [
					'beverage',
					'caffeine',
					'latte',
					'espresso',
					'coffee',
					'mug',
					'cafe',
					'chocolate',
					'drink',
					'steaming',
					'tea'
				]
			},
			{
				shortcode: 'teacup_without_handle',
				char: '🍵',
				keywords: [
					'drink',
					'bowl',
					'breakfast',
					'green',
					'british',
					'beverage',
					'cup',
					'matcha',
					'tea'
				]
			},
			{
				shortcode: 'cup_with_straw',
				char: '🥤',
				keywords: [
					'drink',
					'soda',
					'go',
					'juice',
					'malt',
					'milkshake',
					'pop',
					'smoothie',
					'soft',
					'tableware',
					'water'
				]
			},
			{
				shortcode: 'beer_mug',
				char: '🍺',
				keywords: [
					'relax',
					'beverage',
					'drink',
					'drunk',
					'party',
					'pub',
					'summer',
					'alcohol',
					'booze',
					'bar',
					'stein'
				]
			},
			{
				shortcode: 'clinking_beer_mugs',
				char: '🍻',
				keywords: [
					'relax',
					'beverage',
					'drink',
					'drunk',
					'party',
					'pub',
					'summer',
					'alcohol',
					'booze',
					'bar',
					'beers',
					'cheers',
					'clink',
					'drinks',
					'mug'
				]
			},
			{
				shortcode: 'clinking_glasses',
				char: '🥂',
				keywords: [
					'beverage',
					'drink',
					'party',
					'alcohol',
					'celebrate',
					'cheers',
					'wine',
					'champagne',
					'toast',
					'celebration',
					'clink',
					'glass'
				]
			},
			{
				shortcode: 'wine_glass',
				char: '🍷',
				keywords: ['drink', 'beverage', 'drunk', 'alcohol', 'booze', 'bar', 'red']
			},
			{
				shortcode: 'cocktail_glass',
				char: '🍸',
				keywords: ['drink', 'drunk', 'alcohol', 'beverage', 'booze', 'mojito', 'bar', 'martini']
			},
			{
				shortcode: 'tropical_drink',
				char: '🍹',
				keywords: [
					'beverage',
					'cocktail',
					'summer',
					'beach',
					'alcohol',
					'booze',
					'mojito',
					'bar',
					'fruit',
					'punch',
					'tiki',
					'vacation'
				]
			},
			{ shortcode: 'beverage_box', char: '🧃', keywords: ['drink', 'juice', 'straw', 'sweet'] },
			{
				shortcode: 'bubble_tea',
				char: '🧋',
				keywords: ['taiwan', 'boba', 'straw', 'momi', 'pearl', 'tapioca']
			}
		]
	},
	{
		name: 'Activities',
		emoji: [
			{ shortcode: 'soccer_ball', char: '⚽', keywords: ['sports', 'football'] },
			{
				shortcode: 'basketball',
				char: '🏀',
				keywords: ['sports', 'balls', 'nba', 'ball', 'hoop', 'orange']
			},
			{
				shortcode: 'american_football',
				char: '🏈',
				keywords: ['sports', 'balls', 'nfl', 'ball', 'gridiron', 'superbowl']
			},
			{ shortcode: 'baseball', char: '⚾', keywords: ['sports', 'balls', 'ball', 'softball'] },
			{
				shortcode: 'softball',
				char: '🥎',
				keywords: ['sports', 'balls', 'ball', 'game', 'glove', 'sport', 'underarm']
			},
			{
				shortcode: 'tennis',
				char: '🎾',
				keywords: ['sports', 'balls', 'green', 'ball', 'racket', 'racquet']
			},
			{ shortcode: 'volleyball', char: '🏐', keywords: ['sports', 'balls', 'ball', 'game'] },
			{
				shortcode: 'rugby_football',
				char: '🏉',
				keywords: ['sports', 'team', 'ball', 'league', 'union']
			},
			{
				shortcode: 'flying_disc',
				char: '🥏',
				keywords: ['sports', 'frisbee', 'ultimate', 'game', 'golf', 'sport']
			},
			{
				shortcode: 'pool_8_ball',
				char: '🎱',
				keywords: [
					'pool',
					'hobby',
					'game',
					'luck',
					'magic',
					'8ball',
					'billiard',
					'billiards',
					'cue',
					'eight',
					'snooker'
				]
			},
			{
				shortcode: 'ping_pong',
				char: '🏓',
				keywords: ['sports', 'pingpong', 'ball', 'bat', 'game', 'paddle', 'table', 'tennis']
			},
			{
				shortcode: 'badminton',
				char: '🏸',
				keywords: ['sports', 'birdie', 'game', 'racquet', 'shuttlecock']
			},
			{ shortcode: 'goal_net', char: '🥅', keywords: ['sports', 'catch'] },
			{
				shortcode: 'flag_in_hole',
				char: '⛳',
				keywords: ['sports', 'business', 'flag', 'hole', 'summer', 'golf']
			},
			{
				shortcode: 'bow_and_arrow',
				char: '🏹',
				keywords: ['sports', 'archer', 'archery', 'sagittarius', 'tool', 'zodiac']
			},
			{
				shortcode: 'fishing_pole',
				char: '🎣',
				keywords: ['food', 'hobby', 'summer', 'entertainment', 'fish', 'rod']
			},
			{ shortcode: 'diving_mask', char: '🤿', keywords: ['sport', 'ocean', 'scuba', 'snorkeling'] },
			{ shortcode: 'boxing_glove', char: '🥊', keywords: ['sports', 'fighting'] },
			{ shortcode: 'martial_arts_uniform', char: '🥋', keywords: ['judo', 'karate', 'taekwondo'] },
			{
				shortcode: 'skis',
				char: '🎿',
				keywords: ['sports', 'winter', 'cold', 'snow', 'boot', 'ski', 'skiing']
			},
			{ shortcode: 'skier', char: '⛷️', keywords: ['sports', 'winter', 'snow', 'ski'] },
			{
				shortcode: 'snowboarder',
				char: '🏂',
				keywords: ['sports', 'winter', 'ski', 'snow', 'snowboard', 'snowboarding']
			},
			{
				shortcode: 'person_lifting_weights',
				char: '🏋️',
				keywords: [
					'sports',
					'training',
					'exercise',
					'bodybuilder',
					'gym',
					'lifter',
					'weight',
					'weightlifter',
					'workout'
				]
			},
			{
				shortcode: 'video_game',
				char: '🎮',
				keywords: [
					'play',
					'console',
					'ps4',
					'controller',
					'entertainment',
					'gamepad',
					'playstation',
					'u',
					'wii',
					'xbox'
				]
			},
			{ shortcode: 'joystick', char: '🕹️', keywords: ['game', 'play', 'entertainment', 'video'] },
			{
				shortcode: 'game_die',
				char: '🎲',
				keywords: ['dice', 'random', 'tabletop', 'play', 'luck', 'entertainment', 'gambling']
			},
			{
				shortcode: 'puzzle_piece',
				char: '🧩',
				keywords: ['interlocking', 'puzzle', 'piece', 'clue', 'jigsaw']
			},
			{
				shortcode: 'direct_hit',
				char: '🎯',
				keywords: [
					'game',
					'play',
					'bar',
					'target',
					'bullseye',
					'activity',
					'archery',
					'bull',
					'dart',
					'darts',
					'entertainment',
					'eye'
				]
			},
			{
				shortcode: 'bowling',
				char: '🎳',
				keywords: ['sports', 'fun', 'play', 'ball', 'game', 'pin', 'pins', 'skittles', 'ten']
			},
			{
				shortcode: 'performing_arts',
				char: '🎭',
				keywords: [
					'acting',
					'theater',
					'drama',
					'activity',
					'art',
					'comedy',
					'entertainment',
					'greek',
					'logo',
					'mask',
					'masks',
					'theatre',
					'tragedy'
				]
			},
			{
				shortcode: 'artist_palette',
				char: '🎨',
				keywords: [
					'design',
					'paint',
					'draw',
					'colors',
					'activity',
					'art',
					'entertainment',
					'museum',
					'painting',
					'improve'
				]
			},
			{
				shortcode: 'clapper_board',
				char: '🎬',
				keywords: [
					'movie',
					'film',
					'record',
					'activity',
					'clapboard',
					'director',
					'entertainment',
					'slate'
				]
			},
			{
				shortcode: 'microphone',
				char: '🎤',
				keywords: [
					'sound',
					'music',
					'pa',
					'sing',
					'talkshow',
					'activity',
					'entertainment',
					'karaoke',
					'mic',
					'singing'
				]
			},
			{
				shortcode: 'headphone',
				char: '🎧',
				keywords: [
					'music',
					'score',
					'gadgets',
					'activity',
					'earbud',
					'earphone',
					'earphones',
					'entertainment',
					'headphones',
					'ipod'
				]
			},
			{
				shortcode: 'musical_score',
				char: '🎼',
				keywords: ['treble', 'clef', 'compose', 'activity', 'entertainment', 'music', 'sheet']
			},
			{
				shortcode: 'musical_keyboard',
				char: '🎹',
				keywords: ['piano', 'instrument', 'compose', 'activity', 'entertainment', 'music']
			},
			{ shortcode: 'drum', char: '🥁', keywords: ['music', 'instrument', 'drumsticks', 'snare'] },
			{
				shortcode: 'saxophone',
				char: '🎷',
				keywords: ['music', 'instrument', 'jazz', 'blues', 'activity', 'entertainment', 'sax']
			},
			{
				shortcode: 'trumpet',
				char: '🎺',
				keywords: ['music', 'brass', 'activity', 'entertainment', 'horn', 'instrument', 'jazz']
			},
			{
				shortcode: 'guitar',
				char: '🎸',
				keywords: ['music', 'instrument', 'activity', 'bass', 'electric', 'entertainment', 'rock']
			},
			{
				shortcode: 'violin',
				char: '🎻',
				keywords: [
					'music',
					'instrument',
					'orchestra',
					'symphony',
					'activity',
					'entertainment',
					'quartet',
					'smallest',
					'string'
				]
			},
			{
				shortcode: 'trophy',
				char: '🏆',
				keywords: [
					'win',
					'award',
					'contest',
					'place',
					'ftw',
					'ceremony',
					'championship',
					'prize',
					'winner',
					'winners'
				]
			},
			{ shortcode: '1st_place_medal', char: '🥇', keywords: ['award', 'winning', 'first', 'gold'] },
			{ shortcode: '2nd_place_medal', char: '🥈', keywords: ['award', 'second', 'silver'] },
			{ shortcode: '3rd_place_medal', char: '🥉', keywords: ['award', 'third', 'bronze'] },
			{ shortcode: 'sports_medal', char: '🏅', keywords: ['award', 'winning', 'gold', 'winner'] },
			{
				shortcode: 'military_medal',
				char: '🎖️',
				keywords: ['award', 'winning', 'army', 'celebration', 'decoration', 'medallion']
			},
			{
				shortcode: 'circus_tent',
				char: '🎪',
				keywords: ['festival', 'carnival', 'party', 'activity', 'big', 'entertainment', 'top']
			}
		]
	},
	{
		name: 'Objects',
		emoji: [
			{
				shortcode: 'light_bulb',
				char: '💡',
				keywords: ['light', 'electricity', 'idea', 'comic', 'electric']
			},
			{
				shortcode: 'flashlight',
				char: '🔦',
				keywords: ['dark', 'camping', 'sight', 'night', 'electric', 'light', 'tool', 'torch']
			},
			{ shortcode: 'candle', char: '🕯️', keywords: ['fire', 'wax', 'light'] },
			{
				shortcode: 'mobile_phone',
				char: '📱',
				keywords: [
					'technology',
					'apple',
					'gadgets',
					'dial',
					'cell',
					'communication',
					'iphone',
					'smartphone',
					'telephone',
					'responsive_design'
				]
			},
			{
				shortcode: 'laptop',
				char: '💻',
				keywords: [
					'technology',
					'screen',
					'display',
					'monitor',
					'computer',
					'desktop',
					'notebook',
					'pc',
					'personal'
				]
			},
			{
				shortcode: 'keyboard',
				char: '⌨️',
				keywords: ['technology', 'computer', 'type', 'input', 'text']
			},
			{
				shortcode: 'desktop_computer',
				char: '🖥️',
				keywords: ['technology', 'computing', 'screen', 'imac']
			},
			{ shortcode: 'printer', char: '🖨️', keywords: ['paper', 'ink', 'computer'] },
			{
				shortcode: 'camera',
				char: '📷',
				keywords: ['gadgets', 'photography', 'digital', 'entertainment', 'photo', 'video']
			},
			{
				shortcode: 'camera_with_flash',
				char: '📸',
				keywords: ['photography', 'gadgets', 'photo', 'video', 'snapshots']
			},
			{
				shortcode: 'video_camera',
				char: '📹',
				keywords: ['film', 'record', 'camcorder', 'entertainment']
			},
			{
				shortcode: 'movie_camera',
				char: '🎥',
				keywords: ['film', 'record', 'activity', 'cinema', 'entertainment', 'hollywood', 'video']
			},
			{
				shortcode: 'television',
				char: '📺',
				keywords: ['technology', 'program', 'oldschool', 'show', 'entertainment', 'tv', 'video']
			},
			{
				shortcode: 'radio',
				char: '📻',
				keywords: [
					'communication',
					'music',
					'podcast',
					'program',
					'digital',
					'entertainment',
					'video',
					'wireless'
				]
			},
			{
				shortcode: 'studio_microphone',
				char: '🎙️',
				keywords: ['sing', 'recording', 'artist', 'talkshow', 'mic', 'music', 'podcast']
			},
			{ shortcode: 'alarm_clock', char: '⏰', keywords: ['time', 'wake', 'morning'] },
			{
				shortcode: 'watch',
				char: '⌚',
				keywords: ['time', 'accessories', 'apple', 'clock', 'timepiece', 'wrist', 'wristwatch']
			},
			{
				shortcode: 'satellite_antenna',
				char: '📡',
				keywords: ['communication', 'future', 'radio', 'space', 'dish', 'signal']
			},
			{ shortcode: 'battery', char: '🔋', keywords: ['power', 'energy', 'sustain', 'aa', 'phone'] },
			{
				shortcode: 'electric_plug',
				char: '🔌',
				keywords: ['charger', 'power', 'ac', 'adaptor', 'cable', 'electricity']
			},
			{
				shortcode: 'money_bag',
				char: '💰',
				keywords: ['dollar', 'payment', 'coins', 'sale', 'cream', 'moneybag', 'moneybags', 'rich']
			},
			{
				shortcode: 'gem_stone',
				char: '💎',
				keywords: ['blue', 'ruby', 'diamond', 'jewelry', 'gemstone', 'jewel', 'romance']
			},
			{ shortcode: 'key', char: '🔑', keywords: ['lock', 'door', 'password', 'gold'] },
			{ shortcode: 'old_key', char: '🗝️', keywords: ['lock', 'door', 'password', 'clue'] },
			{
				shortcode: 'locked',
				char: '🔒',
				keywords: ['security', 'password', 'padlock', 'closed', 'lock', 'private', 'privacy']
			},
			{
				shortcode: 'unlocked',
				char: '🔓',
				keywords: ['privacy', 'security', 'lock', 'open', 'padlock', 'unlock']
			},
			{
				shortcode: 'package',
				char: '📦',
				keywords: [
					'mail',
					'gift',
					'cardboard',
					'box',
					'moving',
					'communication',
					'parcel',
					'shipping',
					'container'
				]
			},
			{
				shortcode: 'closed_mailbox_with_raised_flag',
				char: '📫',
				keywords: ['email', 'inbox', 'communication', 'mail', 'postbox']
			},
			{
				shortcode: 'memo',
				char: '📝',
				keywords: [
					'write',
					'documents',
					'stationery',
					'pencil',
					'paper',
					'writing',
					'legal',
					'exam',
					'quiz',
					'test',
					'study',
					'compose',
					'communication',
					'document',
					'memorandum',
					'note',
					'documentation'
				]
			},
			{
				shortcode: 'pencil',
				char: '✏️',
				keywords: [
					'stationery',
					'write',
					'paper',
					'writing',
					'school',
					'study',
					'lead',
					'pencil2',
					'typos'
				]
			},
			{
				shortcode: 'pushpin',
				char: '📌',
				keywords: ['stationery', 'mark', 'here', 'location', 'pin', 'tack', 'thumb']
			},
			{ shortcode: 'paperclip', char: '📎', keywords: ['documents', 'stationery', 'clippy'] },
			{
				shortcode: 'scissors',
				char: '✂️',
				keywords: ['stationery', 'cut', 'black', 'cutting', 'tool']
			},
			{
				shortcode: 'wastebasket',
				char: '🗑️',
				keywords: [
					'bin',
					'trash',
					'rubbish',
					'garbage',
					'toss',
					'basket',
					'can',
					'litter',
					'wastepaper'
				]
			},
			{ shortcode: 'magnet', char: '🧲', keywords: ['attraction', 'magnetic', 'horseshoe'] },
			{
				shortcode: 'test_tube',
				char: '🧪',
				keywords: ['chemistry', 'experiment', 'lab', 'science', 'chemist', 'test']
			},
			{
				shortcode: 'dna',
				char: '🧬',
				keywords: ['biologist', 'genetics', 'life', 'double', 'evolution', 'gene', 'helix']
			},
			{
				shortcode: 'microscope',
				char: '🔬',
				keywords: [
					'laboratory',
					'experiment',
					'zoomin',
					'science',
					'study',
					'investigate',
					'magnify',
					'tool'
				]
			},
			{
				shortcode: 'telescope',
				char: '🔭',
				keywords: ['stars', 'space', 'zoom', 'science', 'astronomy', 'stargazing', 'tool']
			},
			{
				shortcode: 'pill',
				char: '💊',
				keywords: [
					'health',
					'medicine',
					'doctor',
					'pharmacy',
					'drug',
					'capsule',
					'drugs',
					'sick',
					'tablet'
				]
			}
		]
	},
	{
		name: 'Symbols',
		emoji: [
			{
				shortcode: 'check_mark_button',
				char: '✅',
				keywords: [
					'green-square',
					'ok',
					'agree',
					'vote',
					'election',
					'answer',
					'tick',
					'green',
					'heavy',
					'symbol',
					'white',
					'pass_tests'
				]
			},
			{
				shortcode: 'cross_mark',
				char: '❌',
				keywords: ['no', 'delete', 'remove', 'cancel', 'red', 'multiplication', 'multiply', 'x']
			},
			{
				shortcode: 'question_mark',
				char: '❓',
				keywords: ['doubt', 'confused', 'black', 'ornament', 'punctuation', 'red']
			},
			{
				shortcode: 'exclamation_mark',
				char: '❗',
				keywords: [
					'heavy_exclamation_mark',
					'danger',
					'surprise',
					'punctuation',
					'wow',
					'warning',
					'bang',
					'red',
					'symbol'
				]
			},
			{
				shortcode: 'double_exclamation_mark',
				char: '‼️',
				keywords: ['exclamation', 'surprise', 'bangbang', 'punctuation', 'red']
			},
			{
				shortcode: 'exclamation_question_mark',
				char: '⁉️',
				keywords: ['wat', 'punctuation', 'surprise', 'interrobang', 'red']
			},
			{
				shortcode: 'hundred_points',
				char: '💯',
				keywords: [
					'score',
					'perfect',
					'numbers',
					'century',
					'exam',
					'quiz',
					'test',
					'pass',
					'hundred',
					'100',
					'full',
					'keep',
					'symbol'
				]
			},
			{
				shortcode: 'red_circle',
				char: '🔴',
				keywords: ['shape', 'error', 'danger', 'geometric', 'large']
			},
			{ shortcode: 'orange_circle', char: '🟠', keywords: ['round', 'geometric', 'large'] },
			{ shortcode: 'yellow_circle', char: '🟡', keywords: ['round', 'geometric', 'large'] },
			{ shortcode: 'green_circle', char: '🟢', keywords: ['round', 'geometric', 'large'] },
			{
				shortcode: 'blue_circle',
				char: '🔵',
				keywords: ['shape', 'icon', 'button', 'geometric', 'large']
			},
			{ shortcode: 'purple_circle', char: '🟣', keywords: ['round', 'geometric', 'large'] },
			{
				shortcode: 'black_circle',
				char: '⚫',
				keywords: ['shape', 'button', 'round', 'geometric', 'medium']
			},
			{
				shortcode: 'white_circle',
				char: '⚪',
				keywords: ['shape', 'round', 'geometric', 'medium']
			},
			{ shortcode: 'brown_circle', char: '🟤', keywords: ['round', 'geometric', 'large'] },
			{
				shortcode: 'large_orange_diamond',
				char: '🔶',
				keywords: ['shape', 'jewel', 'gem', 'geometric']
			},
			{
				shortcode: 'large_blue_diamond',
				char: '🔷',
				keywords: ['shape', 'jewel', 'gem', 'geometric']
			},
			{
				shortcode: 'small_orange_diamond',
				char: '🔸',
				keywords: ['shape', 'jewel', 'gem', 'geometric']
			},
			{
				shortcode: 'small_blue_diamond',
				char: '🔹',
				keywords: ['shape', 'jewel', 'gem', 'geometric']
			},
			{
				shortcode: 'play_button',
				char: '▶️',
				keywords: [
					'blue-square',
					'right',
					'direction',
					'play',
					'arrow',
					'black',
					'forward',
					'pointing',
					'triangle'
				]
			},
			{
				shortcode: 'pause_button',
				char: '⏸️',
				keywords: ['pause', 'blue-square', 'bar', 'double', 'symbol', 'vertical']
			},
			{
				shortcode: 'stop_button',
				char: '⏹️',
				keywords: ['blue-square', 'black', 'for', 'square', 'symbol']
			},
			{
				shortcode: 'record_button',
				char: '⏺️',
				keywords: ['blue-square', 'black', 'circle', 'for', 'symbol']
			},
			{
				shortcode: 'next_track_button',
				char: '⏭️',
				keywords: [
					'forward',
					'next',
					'blue-square',
					'arrow',
					'bar',
					'black',
					'double',
					'pointing',
					'right',
					'scene',
					'skip',
					'symbol',
					'triangle',
					'vertical'
				]
			},
			{
				shortcode: 'last_track_button',
				char: '⏮️',
				keywords: [
					'backward',
					'arrow',
					'bar',
					'black',
					'double',
					'left',
					'pointing',
					'previous',
					'scene',
					'skip',
					'symbol',
					'triangle',
					'vertical'
				]
			},
			{
				shortcode: 'shuffle_tracks_button',
				char: '🔀',
				keywords: [
					'blue-square',
					'shuffle',
					'music',
					'random',
					'arrow',
					'arrows',
					'crossed',
					'rightwards',
					'symbol',
					'twisted',
					'merge'
				]
			},
			{
				shortcode: 'repeat_button',
				char: '🔁',
				keywords: [
					'loop',
					'record',
					'arrow',
					'arrows',
					'circle',
					'clockwise',
					'leftwards',
					'open',
					'retweet',
					'rightwards',
					'symbol'
				]
			},
			{
				shortcode: 'repeat_single_button',
				char: '🔂',
				keywords: [
					'blue-square',
					'loop',
					'arrow',
					'arrows',
					'circle',
					'circled',
					'clockwise',
					'leftwards',
					'number',
					'once',
					'one',
					'open',
					'overlay',
					'rightwards',
					'symbol',
					'track'
				]
			},
			{
				shortcode: 'clockwise_vertical_arrows',
				char: '🔃',
				keywords: [
					'sync',
					'cycle',
					'round',
					'repeat',
					'arrow',
					'circle',
					'downwards',
					'open',
					'reload',
					'upwards'
				]
			},
			{
				shortcode: 'plus_sign',
				char: '➕',
				keywords: ['math', 'calculation', 'addition', 'more', 'increase', 'heavy', 'symbol', 'add']
			},
			{
				shortcode: 'minus_sign',
				char: '➖',
				keywords: ['math', 'calculation', 'subtract', 'less', 'heavy', 'symbol', 'remove']
			},
			{
				shortcode: 'division_sign',
				char: '➗',
				keywords: ['divide', 'math', 'calculation', 'heavy', 'symbol']
			},
			{
				shortcode: 'multiplication_sign',
				char: '✖️',
				keywords: ['math', 'calculation', 'cancel', 'heavy', 'multiply', 'symbol', 'x']
			},
			{
				shortcode: 'recycling_symbol',
				char: '♻️',
				keywords: [
					'arrow',
					'environment',
					'garbage',
					'trash',
					'black',
					'green',
					'logo',
					'recycle',
					'universal',
					'reuse'
				]
			},
			{
				shortcode: 'warning',
				char: '⚠️',
				keywords: ['exclamation', 'wip', 'alert', 'error', 'problem', 'issue', 'sign', 'symbol']
			},
			{
				shortcode: 'prohibited',
				char: '🚫',
				keywords: [
					'forbid',
					'stop',
					'limit',
					'denied',
					'disallow',
					'circle',
					'backslash',
					'banned',
					'block',
					'crossed',
					'entry',
					'forbidden',
					'no',
					'not',
					'red',
					'restricted',
					'sign'
				]
			},
			{
				shortcode: 'no_entry',
				char: '⛔',
				keywords: [
					'limit',
					'security',
					'privacy',
					'bad',
					'denied',
					'stop',
					'circle',
					'forbidden',
					'not',
					'prohibited',
					'traffic'
				]
			},
			{
				shortcode: 'no_mobile_phones',
				char: '📵',
				keywords: [
					'iphone',
					'mute',
					'circle',
					'cell',
					'communication',
					'forbidden',
					'not',
					'phone',
					'prohibited',
					'smartphones',
					'telephone'
				]
			},
			{
				shortcode: 'no_one_under_eighteen',
				char: '🔞',
				keywords: [
					'18',
					'drink',
					'pub',
					'night',
					'minor',
					'circle',
					'age',
					'forbidden',
					'not',
					'nsfw',
					'prohibited',
					'restriction',
					'symbol',
					'underage'
				]
			},
			{
				shortcode: 'infinity',
				char: '♾️',
				keywords: ['forever', 'paper', 'permanent', 'sign', 'unbounded', 'universal']
			},
			{
				shortcode: 'zzz',
				char: '💤',
				keywords: [
					'sleepy',
					'tired',
					'dream',
					'bedtime',
					'boring',
					'comic',
					'sign',
					'sleep',
					'sleeping',
					'symbol'
				]
			},
			{
				shortcode: 'speech_balloon',
				char: '💬',
				keywords: [
					'bubble',
					'words',
					'message',
					'talk',
					'chatting',
					'chat',
					'comic',
					'comment',
					'dialog',
					'text',
					'literals'
				]
			},
			{
				shortcode: 'thought_balloon',
				char: '💭',
				keywords: ['bubble', 'cloud', 'speech', 'thinking', 'dream', 'comic']
			},
			{
				shortcode: 'right_anger_bubble',
				char: '🗯️',
				keywords: ['caption', 'speech', 'thinking', 'mad', 'angry', 'balloon', 'zag', 'zig']
			},
			{
				shortcode: 'white_flag',
				char: '🏳️',
				keywords: ['losing', 'loser', 'lost', 'surrender', 'fail', 'waving']
			},
			{ shortcode: 'black_flag', char: '🏴', keywords: ['pirate', 'waving'] },
			{
				shortcode: 'triangular_flag',
				char: '🚩',
				keywords: ['mark', 'milestone', 'place', 'pole', 'post', 'red', 'flag']
			}
		]
	},
	{
		name: 'Flags',
		emoji: [
			{
				shortcode: 'chequered_flag',
				char: '🏁',
				keywords: [
					'contest',
					'finishline',
					'race',
					'gokart',
					'checkered',
					'finish',
					'girl',
					'grid',
					'milestone',
					'racing'
				]
			},
			{
				shortcode: 'mark',
				char: '🚩',
				keywords: ['milestone', 'place', 'pole', 'post', 'red', 'flag']
			},
			{
				shortcode: 'crossed_flags',
				char: '🎌',
				keywords: [
					'japanese',
					'nation',
					'country',
					'border',
					'activity',
					'celebration',
					'cross',
					'flag',
					'two'
				]
			},
			{
				shortcode: 'pirate_flag',
				char: '🏴‍☠️',
				keywords: ['skull', 'crossbones', 'flag', 'banner', 'jolly', 'plunder', 'roger', 'treasure']
			},
			{
				shortcode: 'flag_united_states',
				char: '🇺🇸',
				keywords: [
					'united',
					'states',
					'america',
					'flag',
					'nation',
					'country',
					'banner',
					'united_states',
					'american',
					'indicator',
					'islands',
					'letters',
					'outlying',
					'regional',
					'symbol',
					'us',
					'usa'
				]
			},
			{
				shortcode: 'flag_united_kingdom',
				char: '🇬🇧',
				keywords: [
					'united',
					'kingdom',
					'great',
					'britain',
					'northern',
					'ireland',
					'flag',
					'nation',
					'country',
					'banner',
					'british',
					'uk',
					'english',
					'england',
					'united_kingdom',
					'cornwall',
					'gb',
					'scotland',
					'wales'
				]
			},
			{
				shortcode: 'flag_japan',
				char: '🇯🇵',
				keywords: [
					'japanese',
					'nation',
					'flag',
					'country',
					'banner',
					'japan',
					'jp',
					'ja',
					'indicator',
					'letters',
					'regional',
					'symbol'
				]
			},
			{
				shortcode: 'flag_south_korea',
				char: '🇰🇷',
				keywords: [
					'south',
					'korea',
					'nation',
					'flag',
					'country',
					'banner',
					'south_korea',
					'indicator',
					'korean',
					'kr',
					'letters',
					'regional',
					'symbol'
				]
			},
			{
				shortcode: 'flag_germany',
				char: '🇩🇪',
				keywords: [
					'german',
					'nation',
					'flag',
					'country',
					'banner',
					'germany',
					'de',
					'deutsch',
					'indicator',
					'letters',
					'regional',
					'symbol'
				]
			},
			{
				shortcode: 'flag_france',
				char: '🇫🇷',
				keywords: [
					'banner',
					'flag',
					'nation',
					'france',
					'french',
					'country',
					'clipperton',
					'fr',
					'indicator',
					'island',
					'letters',
					'martin',
					'regional',
					'saint',
					'symbol'
				]
			},
			{
				shortcode: 'flag_italy',
				char: '🇮🇹',
				keywords: [
					'italy',
					'flag',
					'nation',
					'country',
					'banner',
					'indicator',
					'italian',
					'letters',
					'regional',
					'symbol'
				]
			},
			{
				shortcode: 'flag_spain',
				char: '🇪🇸',
				keywords: [
					'spain',
					'flag',
					'nation',
					'country',
					'banner',
					'ceuta',
					'es',
					'indicator',
					'letters',
					'melilla',
					'regional',
					'spanish',
					'symbol'
				]
			},
			{
				shortcode: 'flag_brazil',
				char: '🇧🇷',
				keywords: [
					'br',
					'flag',
					'nation',
					'country',
					'banner',
					'brazil',
					'brasil',
					'brazilian',
					'for'
				]
			},
			{
				shortcode: 'flag_canada',
				char: '🇨🇦',
				keywords: ['ca', 'flag', 'nation', 'country', 'banner', 'canada', 'canadian']
			},
			{
				shortcode: 'flag_australia',
				char: '🇦🇺',
				keywords: [
					'au',
					'flag',
					'nation',
					'country',
					'banner',
					'australia',
					'aussie',
					'australian',
					'heard',
					'mcdonald'
				]
			},
			{
				shortcode: 'flag_india',
				char: '🇮🇳',
				keywords: ['in', 'flag', 'nation', 'country', 'banner', 'india', 'indian']
			},
			{
				shortcode: 'flag_china',
				char: '🇨🇳',
				keywords: [
					'china',
					'chinese',
					'prc',
					'flag',
					'country',
					'nation',
					'banner',
					'cn',
					'indicator',
					'letters',
					'regional',
					'symbol'
				]
			},
			{
				shortcode: 'flag_russia',
				char: '🇷🇺',
				keywords: [
					'russian',
					'federation',
					'flag',
					'nation',
					'country',
					'banner',
					'russia',
					'indicator',
					'letters',
					'regional',
					'ru',
					'symbol'
				]
			},
			{
				shortcode: 'flag_mexico',
				char: '🇲🇽',
				keywords: ['mx', 'flag', 'nation', 'country', 'banner', 'mexico', 'mexican']
			},
			{
				shortcode: 'flag_turkey',
				char: '🇹🇷',
				keywords: ['turkey', 'flag', 'nation', 'country', 'banner', 'tr']
			},
			{
				shortcode: 'flag_saudi_arabia',
				char: '🇸🇦',
				keywords: ['flag', 'nation', 'country', 'banner', 'saudi_arabia']
			},
			{
				shortcode: 'flag_south_africa',
				char: '🇿🇦',
				keywords: ['south', 'africa', 'flag', 'nation', 'country', 'banner', 'south_africa']
			},
			{
				shortcode: 'flag_nigeria',
				char: '🇳🇬',
				keywords: ['flag', 'nation', 'country', 'banner', 'nigeria', 'nigerian']
			},
			{
				shortcode: 'flag_egypt',
				char: '🇪🇬',
				keywords: ['eg', 'flag', 'nation', 'country', 'banner', 'egypt', 'egyptian']
			},
			{
				shortcode: 'flag_argentina',
				char: '🇦🇷',
				keywords: ['ar', 'flag', 'nation', 'country', 'banner', 'argentina', 'argentinian']
			},
			{
				shortcode: 'flag_chile',
				char: '🇨🇱',
				keywords: ['flag', 'nation', 'country', 'banner', 'chile', 'chilean']
			},
			{
				shortcode: 'flag_colombia',
				char: '🇨🇴',
				keywords: ['co', 'flag', 'nation', 'country', 'banner', 'colombia', 'colombian']
			},
			{
				shortcode: 'flag_pakistan',
				char: '🇵🇰',
				keywords: ['pk', 'flag', 'nation', 'country', 'banner', 'pakistan', 'pakistani']
			},
			{
				shortcode: 'flag_bangladesh',
				char: '🇧🇩',
				keywords: ['bd', 'flag', 'nation', 'country', 'banner', 'bangladesh', 'bangladeshi']
			},
			{
				shortcode: 'flag_indonesia',
				char: '🇮🇩',
				keywords: ['flag', 'nation', 'country', 'banner', 'indonesia', 'indonesian']
			},
			{
				shortcode: 'flag_philippines',
				char: '🇵🇭',
				keywords: ['ph', 'flag', 'nation', 'country', 'banner', 'philippines']
			},
			{
				shortcode: 'flag_vietnam',
				char: '🇻🇳',
				keywords: ['viet', 'nam', 'flag', 'nation', 'country', 'banner', 'vietnam', 'vietnamese']
			},
			{
				shortcode: 'flag_thailand',
				char: '🇹🇭',
				keywords: ['th', 'flag', 'nation', 'country', 'banner', 'thailand', 'thai']
			},
			{
				shortcode: 'flag_malaysia',
				char: '🇲🇾',
				keywords: ['my', 'flag', 'nation', 'country', 'banner', 'malaysia', 'malaysian']
			},
			{
				shortcode: 'flag_singapore',
				char: '🇸🇬',
				keywords: ['sg', 'flag', 'nation', 'country', 'banner', 'singapore', 'singaporean']
			}
		]
	}
];
