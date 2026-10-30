/* JOD Events: "Explore by region" drawer. Visitors pick a state, then a
 * district inside it, and event listings (home carousel, category grid) show
 * events there. Events carry state/district from their venue pin (backend);
 * venue text is the fallback for events without a pin. */
(function (global) {
	"use strict";

	var STORAGE_KEY = "jod_selected_region";
	var CSS_HREF = "/css/region-picker.css?v=1";

	// [code, name, state aliases, "District|District=alias,alias|..."]
	var RAW = [
		["AN", "Andaman and Nicobar Islands", "andaman,andaman & nicobar", "Nicobar|North and Middle Andaman|South Andaman=port blair"],
		["AP", "Andhra Pradesh", "", "Alluri Sitharama Raju|Anakapalli|Anantapur=anantapuramu|Annamayya|Bapatla|Chittoor|Dr. B.R. Ambedkar Konaseema=konaseema|East Godavari=rajahmundry,rajamahendravaram|Eluru|Guntur|Kakinada|Krishna=machilipatnam|Kurnool|Nandyal|NTR=vijayawada|Palnadu|Parvathipuram Manyam|Prakasam=ongole|Sri Potti Sriramulu Nellore=nellore|Sri Sathya Sai=puttaparthi|Srikakulam|Tirupati|Visakhapatnam=vizag|Vizianagaram|West Godavari=bhimavaram|YSR Kadapa=kadapa,cuddapah"],
		["AR", "Arunachal Pradesh", "", "Anjaw|Bichom|Changlang|Dibang Valley|East Kameng|East Siang|Kamle|Keyi Panyor|Kra Daadi|Kurung Kumey|Lepa Rada|Lohit|Longding|Lower Dibang Valley|Lower Siang|Lower Subansiri|Namsai|Pakke Kessang|Papum Pare=itanagar|Shi Yomi|Siang|Tawang|Tirap|Upper Siang|Upper Subansiri|West Kameng|West Siang"],
		["AS", "Assam", "", "Bajali|Baksa|Barpeta|Biswanath|Bongaigaon|Cachar=silchar|Charaideo|Chirang|Darrang|Dhemaji|Dhubri|Dibrugarh|Dima Hasao|Goalpara|Golaghat|Hailakandi|Hojai|Jorhat|Kamrup|Kamrup Metropolitan=guwahati|Karbi Anglong|Karimganj=sribhumi|Kokrajhar|Lakhimpur|Majuli|Morigaon|Nagaon|Nalbari|Sivasagar|Sonitpur=tezpur|South Salmara-Mankachar|Tamulpur|Tinsukia|Udalguri|West Karbi Anglong"],
		["BR", "Bihar", "", "Araria|Arwal|Aurangabad|Banka|Begusarai|Bhagalpur|Bhojpur=arrah|Buxar|Darbhanga|East Champaran=purba champaran,motihari|Gaya|Gopalganj|Jamui|Jehanabad|Kaimur|Katihar|Khagaria|Kishanganj|Lakhisarai|Madhepura|Madhubani|Munger|Muzaffarpur|Nalanda|Nawada|Patna|Purnia|Rohtas|Saharsa|Samastipur|Saran=chhapra|Sheikhpura|Sheohar|Sitamarhi|Siwan|Supaul|Vaishali|West Champaran=pashchim champaran"],
		["CH", "Chandigarh", "", "Chandigarh"],
		["CG", "Chhattisgarh", "chattisgarh", "Balod|Baloda Bazar|Balrampur|Bastar=jagdalpur|Bemetara|Bijapur|Bilaspur|Dantewada|Dhamtari|Durg=bhilai|Gariaband|Gaurela-Pendra-Marwahi|Janjgir-Champa|Jashpur|Kabirdham=kawardha|Kanker|Khairagarh-Chhuikhadan-Gandai|Kondagaon|Korba|Koriya|Mahasamund|Manendragarh-Chirmiri-Bharatpur|Mohla-Manpur-Ambagarh Chowki|Mungeli|Narayanpur|Raigarh|Raipur|Rajnandgaon|Sakti|Sarangarh-Bilaigarh|Sukma|Surajpur|Surguja=ambikapur"],
		["DN", "Dadra and Nagar Haveli and Daman and Diu", "daman and diu,dadra and nagar haveli", "Dadra and Nagar Haveli=silvassa|Daman|Diu"],
		["DL", "Delhi", "nct of delhi,new delhi,delhi ncr", "Central Delhi|East Delhi|New Delhi|North Delhi|North East Delhi|North West Delhi|Shahdara|South Delhi|South East Delhi|South West Delhi=dwarka|West Delhi"],
		["GA", "Goa", "", "North Goa=panaji,panjim,mapusa,calangute,baga|South Goa=margao,madgaon,vasco"],
		["GJ", "Gujarat", "", "Ahmedabad|Amreli|Anand|Aravalli|Banaskantha|Bharuch|Bhavnagar|Botad|Chhota Udaipur|Dahod|Dang|Devbhoomi Dwarka=dwarka|Gandhinagar|Gir Somnath=somnath,veraval|Jamnagar|Junagadh|Kheda|Kutch=kachchh,bhuj|Mahisagar|Mehsana=mahesana|Morbi|Narmada|Navsari|Panchmahal=panchmahals,godhra|Patan|Porbandar|Rajkot|Sabarkantha|Surat|Surendranagar|Tapi|Vadodara=baroda|Valsad=vapi"],
		["HR", "Haryana", "", "Ambala|Bhiwani|Charkhi Dadri|Faridabad|Fatehabad|Gurugram=gurgaon|Hisar|Jhajjar|Jind|Kaithal|Karnal|Kurukshetra|Mahendragarh|Nuh=mewat|Palwal|Panchkula|Panipat|Rewari|Rohtak|Sirsa|Sonipat|Yamunanagar"],
		["HP", "Himachal Pradesh", "", "Bilaspur|Chamba|Hamirpur|Kangra=dharamshala|Kinnaur|Kullu=manali|Lahaul and Spiti|Mandi|Shimla|Sirmaur|Solan|Una"],
		["JK", "Jammu and Kashmir", "j&k,jammu & kashmir", "Anantnag|Bandipora|Baramulla|Budgam|Doda|Ganderbal|Jammu|Kathua|Kishtwar|Kulgam|Kupwara|Poonch|Pulwama|Rajouri|Ramban|Reasi|Samba|Shopian|Srinagar|Udhampur"],
		["JH", "Jharkhand", "", "Bokaro|Chatra|Deoghar|Dhanbad|Dumka|East Singhbhum=jamshedpur,purbi singhbhum|Garhwa|Giridih|Godda|Gumla|Hazaribagh|Jamtara|Khunti|Koderma|Latehar|Lohardaga|Pakur|Palamu|Ramgarh|Ranchi|Sahibganj|Seraikela Kharsawan|Simdega|West Singhbhum=chaibasa,pashchimi singhbhum"],
		["KA", "Karnataka", "", "Bagalkot|Ballari=bellary|Belagavi=belgaum|Bengaluru Rural=bangalore rural|Bengaluru Urban=bengaluru,bangalore,bangalore urban|Bidar|Chamarajanagar|Chikkaballapur|Chikkamagaluru=chikmagalur|Chitradurga|Dakshina Kannada=mangaluru,mangalore|Davanagere|Dharwad=hubballi,hubli|Gadag|Hassan|Haveri|Kalaburagi=gulbarga|Kodagu=coorg,madikeri|Kolar|Koppal|Mandya|Mysuru=mysore|Raichur|Ramanagara|Shivamogga=shimoga|Tumakuru=tumkur|Udupi=manipal|Uttara Kannada=karwar|Vijayanagara=hosapete,hospet|Vijayapura=bijapur|Yadgir"],
		["KL", "Kerala", "", "Alappuzha=alleppey|Ernakulam=kochi,cochin|Idukki=munnar|Kannur=cannanore|Kasaragod|Kollam=quilon|Kottayam|Kozhikode=calicut|Malappuram|Palakkad=palghat|Pathanamthitta|Thiruvananthapuram=trivandrum|Thrissur=trichur|Wayanad"],
		["LA", "Ladakh", "", "Kargil|Leh"],
		["LD", "Lakshadweep", "", "Lakshadweep=kavaratti"],
		["MP", "Madhya Pradesh", "", "Agar Malwa|Alirajpur|Anuppur|Ashoknagar|Balaghat|Barwani|Betul|Bhind|Bhopal|Burhanpur|Chhatarpur=khajuraho|Chhindwara|Damoh|Datia|Dewas|Dhar|Dindori|Guna|Gwalior|Harda|Indore|Jabalpur|Jhabua|Katni|Khandwa|Khargone|Maihar|Mandla|Mandsaur|Mauganj|Morena|Narmadapuram=hoshangabad|Narsinghpur|Neemuch|Niwari|Pandhurna|Panna|Raisen|Rajgarh|Ratlam|Rewa|Sagar|Satna|Sehore|Seoni|Shahdol|Shajapur|Sheopur|Shivpuri|Sidhi|Singrauli|Tikamgarh|Ujjain|Umaria|Vidisha"],
		["MH", "Maharashtra", "", "Ahmednagar=ahilyanagar|Akola|Amravati|Beed|Bhandara|Buldhana|Chandrapur|Chhatrapati Sambhajinagar=aurangabad|Dharashiv=osmanabad|Dhule|Gadchiroli|Gondia|Hingoli|Jalgaon|Jalna|Kolhapur|Latur|Mumbai City=mumbai,bombay|Mumbai Suburban=mumbai,andheri,bandra|Nagpur|Nanded|Nandurbar|Nashik=nasik|Palghar|Parbhani|Pune=poona,pimpri,chinchwad|Raigad=alibag|Ratnagiri|Sangli|Satara|Sindhudurg|Solapur|Thane=navi mumbai,kalyan|Wardha|Washim|Yavatmal"],
		["MN", "Manipur", "", "Bishnupur|Chandel|Churachandpur|Imphal East|Imphal West=imphal|Jiribam|Kakching|Kamjong|Kangpokpi|Noney|Pherzawl|Senapati|Tamenglong|Tengnoupal|Thoubal|Ukhrul"],
		["ML", "Meghalaya", "", "East Garo Hills|East Jaintia Hills|East Khasi Hills=shillong|Eastern West Khasi Hills|North Garo Hills|Ri Bhoi|South Garo Hills|South West Garo Hills|South West Khasi Hills|West Garo Hills=tura|West Jaintia Hills|West Khasi Hills"],
		["MZ", "Mizoram", "", "Aizawl|Champhai|Hnahthial|Khawzawl|Kolasib|Lawngtlai|Lunglei|Mamit|Saitual|Serchhip|Siaha"],
		["NL", "Nagaland", "", "Chumoukedima|Dimapur|Kiphire|Kohima|Longleng|Meluri|Mokokchung|Mon|Niuland|Noklak|Peren|Phek|Shamator|Tseminyu|Tuensang|Wokha|Zunheboto"],
		["OD", "Odisha", "orissa", "Angul|Balangir=bolangir|Balasore=baleshwar|Bargarh|Bhadrak|Boudh|Cuttack|Deogarh|Dhenkanal|Gajapati|Ganjam=berhampur,brahmapur|Jagatsinghpur|Jajpur|Jharsuguda|Kalahandi|Kandhamal|Kendrapara|Kendujhar=keonjhar|Khordha=bhubaneswar,khurda|Koraput|Malkangiri|Mayurbhanj|Nabarangpur|Nayagarh|Nuapada|Puri|Rayagada|Sambalpur|Subarnapur=sonepur|Sundargarh=rourkela"],
		["PY", "Puducherry", "pondicherry,pondy", "Karaikal|Mahe|Puducherry=pondicherry,pondy|Yanam"],
		["PB", "Punjab", "", "Amritsar|Barnala|Bathinda|Faridkot|Fatehgarh Sahib|Fazilka|Ferozepur=firozpur|Gurdaspur|Hoshiarpur|Jalandhar|Kapurthala|Ludhiana|Malerkotla|Mansa|Moga|Pathankot|Patiala|Rupnagar=ropar|Sahibzada Ajit Singh Nagar=mohali,sas nagar|Sangrur|Shaheed Bhagat Singh Nagar=nawanshahr|Sri Muktsar Sahib=muktsar|Tarn Taran"],
		["RJ", "Rajasthan", "", "Ajmer|Alwar|Balotra|Banswara|Baran|Barmer|Beawar|Bharatpur|Bhilwara|Bikaner|Bundi|Chittorgarh=chittaurgarh|Churu|Dausa|Deeg|Dholpur|Didwana-Kuchaman|Dungarpur|Hanumangarh|Jaipur|Jaisalmer|Jalore=jalor|Jhalawar|Jhunjhunu|Jodhpur|Karauli|Khairthal-Tijara|Kota|Kotputli-Behror|Nagaur|Pali|Phalodi|Pratapgarh|Rajsamand|Salumbar|Sawai Madhopur|Sikar|Sirohi=mount abu|Sri Ganganagar=ganganagar|Tonk|Udaipur"],
		["SK", "Sikkim", "", "Gangtok|Gyalshing|Mangan|Namchi|Pakyong|Soreng"],
		["TN", "Tamil Nadu", "tamilnadu", "Ariyalur|Chengalpattu=tambaram,mahabalipuram,mamallapuram|Chennai=madras|Coimbatore=kovai|Cuddalore|Dharmapuri|Dindigul=kodaikanal|Erode|Kallakurichi|Kancheepuram=kanchipuram|Kanniyakumari=kanyakumari,nagercoil|Karur|Krishnagiri=hosur|Madurai|Mayiladuthurai|Nagapattinam|Namakkal|Nilgiris=the nilgiris,ooty,udhagamandalam,coonoor|Perambalur|Pudukkottai|Ramanathapuram=rameswaram|Ranipet|Salem|Sivaganga=sivagangai,karaikudi|Tenkasi|Thanjavur=tanjore|Theni|Thoothukudi=tuticorin|Tiruchirappalli=trichy,tiruchi|Tirunelveli=nellai|Tirupathur|Tiruppur=tirupur|Tiruvallur=thiruvallur|Tiruvannamalai=thiruvannamalai|Tiruvarur=thiruvarur|Vellore|Viluppuram=villupuram|Virudhunagar=sivakasi"],
		["TS", "Telangana", "", "Adilabad|Bhadradri Kothagudem|Hanumakonda|Hyderabad=secunderabad|Jagtial|Jangaon|Jayashankar Bhupalpally|Jogulamba Gadwal|Kamareddy|Karimnagar|Khammam|Kumuram Bheem Asifabad|Mahabubabad|Mahabubnagar|Mancherial|Medak|Medchal-Malkajgiri=medchal,kompally|Mulugu|Nagarkurnool|Nalgonda|Narayanpet|Nirmal|Nizamabad|Peddapalli|Rajanna Sircilla|Rangareddy=ranga reddy,gachibowli,hitech city|Sangareddy|Siddipet|Suryapet|Vikarabad|Wanaparthy|Warangal|Yadadri Bhuvanagiri"],
		["TR", "Tripura", "", "Dhalai|Gomati|Khowai|North Tripura|Sepahijala|South Tripura|Unakoti|West Tripura=agartala"],
		["UP", "Uttar Pradesh", "", "Agra|Aligarh|Ambedkar Nagar|Amethi|Amroha|Auraiya|Ayodhya=faizabad|Azamgarh|Baghpat|Bahraich|Ballia|Balrampur|Banda|Barabanki|Bareilly|Basti|Bhadohi|Bijnor|Budaun|Bulandshahr|Chandauli|Chitrakoot|Deoria|Etah|Etawah|Farrukhabad|Fatehpur|Firozabad|Gautam Buddha Nagar=noida,greater noida|Ghaziabad|Ghazipur|Gonda|Gorakhpur|Hamirpur|Hapur|Hardoi|Hathras|Jalaun|Jaunpur|Jhansi|Kannauj|Kanpur Dehat|Kanpur Nagar=kanpur|Kasganj|Kaushambi|Kushinagar|Lakhimpur Kheri|Lalitpur|Lucknow|Maharajganj|Mahoba|Mainpuri|Mathura|Mau|Meerut|Mirzapur|Moradabad|Muzaffarnagar|Pilibhit|Pratapgarh|Prayagraj=allahabad|Raebareli|Rampur|Saharanpur|Sambhal|Sant Kabir Nagar|Shahjahanpur|Shamli|Shravasti|Siddharthnagar|Sitapur|Sonbhadra|Sultanpur|Unnao|Varanasi=banaras,kashi"],
		["UK", "Uttarakhand", "uttaranchal", "Almora|Bageshwar|Chamoli|Champawat|Dehradun=mussoorie|Haridwar=hardwar,roorkee|Nainital=haldwani|Pauri Garhwal|Pithoragarh|Rudraprayag|Tehri Garhwal|Udham Singh Nagar=rudrapur|Uttarkashi"],
		["WB", "West Bengal", "", "Alipurduar|Bankura|Birbhum|Cooch Behar=koch bihar|Dakshin Dinajpur|Darjeeling|Hooghly=hugli|Howrah|Jalpaiguri|Jhargram|Kalimpong|Kolkata=calcutta|Malda|Murshidabad|Nadia|North 24 Parganas=salt lake,bidhannagar,new town|Paschim Bardhaman=asansol,durgapur|Paschim Medinipur|Purba Bardhaman=burdwan,bardhaman|Purba Medinipur=digha|Purulia|South 24 Parganas|Uttar Dinajpur"]
	];
	var QUICK = [["TN", "Chennai"], ["TN", "Coimbatore"], ["TN", "Madurai"], ["KA", "Bengaluru Urban"], ["TS", "Hyderabad"], ["KL", "Ernakulam"], ["MH", "Mumbai City"], ["DL", "New Delhi"]];

	function norm(s) {
		return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\bdistrict\b/g, "").replace(/[^a-z]/g, "");
	}

	var STATES = RAW.map(function (row) {
		var state = { code: row[0], name: row[1], aliases: [row[1].toLowerCase()].concat(row[2] ? row[2].split(",") : []), districts: [] };
		state.keys = state.aliases.map(norm);
		state.districts = row[3].split("|").map(function (part) {
			var bits = part.split("=");
			var name = bits[0];
			var aliases = [name.toLowerCase()].concat(bits[1] ? bits[1].split(",") : []);
			return { name: name, state: state, aliases: aliases, keys: aliases.map(norm) };
		});
		return state;
	});

	function stateByCode(code) {
		for (var i = 0; i < STATES.length; i++) if (STATES[i].code === code) return STATES[i];
		return null;
	}
	function districtIn(state, name) {
		if (!state) return null;
		var key = norm(name);
		for (var i = 0; i < state.districts.length; i++) if (state.districts[i].keys.indexOf(key) !== -1) return state.districts[i];
		return null;
	}

	function levenshtein(a, b) {
		if (a === b) return 0;
		var prev = [], cur = [], i, j;
		for (j = 0; j <= b.length; j++) prev[j] = j;
		for (i = 1; i <= a.length; i++) {
			cur = [i];
			for (j = 1; j <= b.length; j++) {
				cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			}
			prev = cur;
		}
		return prev[b.length];
	}
	function keyMatches(keys, value) {
		var v = norm(value);
		if (!v) return false;
		return keys.some(function (k) { return k === v || (k.length >= 7 && Math.abs(k.length - v.length) <= 2 && levenshtein(k, v) <= 2); });
	}
	function stateOfName(value) {
		for (var i = 0; i < STATES.length; i++) if (keyMatches(STATES[i].keys, value)) return STATES[i];
		return null;
	}

	function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
	function mentions(aliases, text) {
		var hay = " " + String(text || "").toLowerCase() + " ";
		return aliases.some(function (alias) {
			return alias.length >= 4 && new RegExp("(^|[^a-z])" + escapeRe(alias) + "([^a-z]|$)").test(hay);
		});
	}

	/* ── Selection ─────────────────────────────────────────── */

	function selection(state, district) {
		if (!state) return null;
		return {
			state: state,
			district: district || null,
			name: district ? district.name : state.name,
			label: district ? district.name + ", " + state.code : state.name
		};
	}

	function getRegion() {
		try {
			var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
			if (!raw || !raw.state) return null;
			var state = stateByCode(raw.state);
			return selection(state, raw.district ? districtIn(state, raw.district) : null);
		} catch (_) {
			return null;
		}
	}

	function hasChosen() {
		try { return localStorage.getItem(STORAGE_KEY) != null; } catch (_) { return false; }
	}

	function matchesEvent(ev, sel) {
		sel = sel === undefined ? getRegion() : sel;
		if (!sel || !ev) return true;
		var text = [ev.venue, ev.location, ev.address].filter(Boolean).join(" ");
		var stateKnown = Boolean(ev.state);
		if (stateKnown && !keyMatches(sel.state.keys, ev.state)) return false;
		if (sel.district) {
			if (ev.district) return keyMatches(sel.district.keys, ev.district);
			return mentions(sel.district.aliases, text);
		}
		if (stateKnown) return true;
		if (mentions(sel.state.aliases, text)) return true;
		return sel.state.districts.some(function (d) { return mentions(d.aliases, text); });
	}

	function filterEvents(list, sel) {
		sel = sel === undefined ? getRegion() : sel;
		if (!Array.isArray(list)) return [];
		if (!sel) return list;
		return list.filter(function (ev) { return matchesEvent(ev, sel); });
	}

	/* ── UI ─────────────────────────────────────────────────── */

	function esc(v) {
		return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
		});
	}

	function apiBase() {
		if (global.JodConfig && typeof global.JodConfig.getApiOrigin === "function") return global.JodConfig.getApiOrigin();
		if (global.JOD_API_BASE_OVERRIDE) return String(global.JOD_API_BASE_OVERRIDE).replace(/\/$/, "");
		return "";
	}

	function ensureCss() {
		if (document.getElementById("jodRegionCss")) return Promise.resolve();
		return new Promise(function (resolve) {
			var link = document.createElement("link");
			link.id = "jodRegionCss";
			link.rel = "stylesheet";
			link.href = CSS_HREF;
			link.onload = resolve;
			link.onerror = resolve;
			document.head.appendChild(link);
		});
	}

	var root = null;
	var openCode = null;
	var lastFocus = null;

	function build() {
		if (root) return root;
		root = document.createElement("div");
		root.className = "jod-region";
		root.hidden = true;
		root.innerHTML =
			'<div class="jod-region-backdrop" data-region-close></div>' +
			'<aside class="jod-region-panel" role="dialog" aria-modal="true" aria-labelledby="jodRegionTitle">' +
			'<header class="jod-region-head">' +
			'<div><p class="jod-region-kicker">Explore events</p><h2 id="jodRegionTitle">Where are you headed?</h2></div>' +
			'<button type="button" class="jod-region-close" data-region-close aria-label="Close">&times;</button>' +
			'<ol class="jod-region-steps" aria-label="Steps"><li data-step="1"><span>1</span>State</li><li data-step="2"><span>2</span>District</li></ol>' +
			"</header>" +
			'<div class="jod-region-tools">' +
			'<label class="jod-region-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
			'<input type="text" id="jodRegionSearch" placeholder="Search a state or district" autocomplete="off" aria-label="Search a state or district" /></label>' +
			'<button type="button" class="jod-region-locate" id="jodRegionLocate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/></svg>Use my location</button>' +
			"</div>" +
			'<p class="jod-region-status" id="jodRegionStatus" role="status" hidden></p>' +
			'<div class="jod-region-body">' +
			'<div class="jod-region-current" id="jodRegionCurrent" hidden></div>' +
			'<section class="jod-region-quick" id="jodRegionQuick"><h3>Quick picks</h3><div id="jodRegionQuickList"></div></section>' +
			'<h3 class="jod-region-h" id="jodRegionStatesHead">Choose a state</h3>' +
			'<div class="jod-region-list" id="jodRegionList"></div>' +
			'<p class="jod-region-empty" id="jodRegionEmpty" hidden>No state or district matches that search.</p>' +
			"</div>" +
			'<footer class="jod-region-foot"><button type="button" class="jod-region-anywhere" data-region-all>Show events across India</button></footer>' +
			"</aside>";
		document.body.appendChild(root);

		root.addEventListener("click", function (e) {
			if (e.target.closest("[data-region-close]")) return close();
			if (e.target.closest("[data-region-all]")) return choose(null, null);
			var stateBtn = e.target.closest("[data-state-toggle]");
			if (stateBtn) return toggleState(stateBtn.getAttribute("data-state-toggle"));
			var whole = e.target.closest("[data-pick-state]");
			if (whole) return choose(whole.getAttribute("data-pick-state"), null);
			var dist = e.target.closest("[data-pick-district]");
			if (dist) {
				var parts = dist.getAttribute("data-pick-district").split("|");
				return choose(parts[0], parts[1]);
			}
		});
		root.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
		root.querySelector("#jodRegionSearch").addEventListener("input", function () { render(); });
		root.querySelector("#jodRegionLocate").addEventListener("click", locate);
		return root;
	}

	function setStatus(text) {
		var el = root && root.querySelector("#jodRegionStatus");
		if (!el) return;
		el.textContent = text || "";
		el.hidden = !text;
	}

	function districtChip(d, current) {
		var on = current && current.district === d;
		return '<button type="button" class="jod-region-chip' + (on ? " is-on" : "") + '" data-pick-district="' + d.state.code + "|" + esc(d.name) + '" aria-pressed="' + Boolean(on) + '">' + esc(d.name) + "</button>";
	}

	function render() {
		var current = getRegion();
		var q = String(root.querySelector("#jodRegionSearch").value || "").trim().toLowerCase();
		var qKey = norm(q);
		var steps = root.querySelectorAll(".jod-region-steps li");
		var stage = current && current.district ? 3 : (openCode ? 2 : 1);
		steps.forEach(function (li) {
			var n = Number(li.getAttribute("data-step"));
			li.classList.toggle("is-on", n === stage || (stage === 3 && n === 2));
			li.classList.toggle("is-done", n < stage);
		});

		var cur = root.querySelector("#jodRegionCurrent");
		cur.hidden = !current;
		cur.innerHTML = current
			? '<span>Showing events in</span><strong>' + esc(current.district ? current.district.name + ", " + current.state.name : current.state.name) + '</strong><button type="button" data-region-all>Clear</button>'
			: "";

		var quick = root.querySelector("#jodRegionQuick");
		quick.hidden = Boolean(q);
		root.querySelector("#jodRegionQuickList").innerHTML = QUICK.map(function (pair) {
			var d = districtIn(stateByCode(pair[0]), pair[1]);
			return d ? districtChip(d, current) : "";
		}).join("");

		var shown = 0;
		var html = STATES.map(function (state) {
			var stateHit = !q || state.aliases.some(function (a) { return a.indexOf(q) !== -1; }) || state.code.toLowerCase() === q;
			var districtHits = q ? state.districts.filter(function (d) {
				return d.aliases.some(function (a) { return a.indexOf(q) !== -1; }) || (qKey.length >= 4 && d.keys.some(function (k) { return k.indexOf(qKey) !== -1; }));
			}) : [];
			if (!stateHit && !districtHits.length) return "";
			shown++;
			var isOpen = openCode === state.code || (q && districtHits.length && !stateHit);
			var isCurrent = current && current.state === state;
			var list = isOpen ? (q && !stateHit ? districtHits : state.districts) : [];
			return '<div class="jod-region-state' + (isOpen ? " is-open" : "") + (isCurrent ? " is-current" : "") + '">' +
				'<button type="button" class="jod-region-state-btn" data-state-toggle="' + state.code + '" aria-expanded="' + Boolean(isOpen) + '">' +
				'<span class="jod-region-code">' + state.code + '</span>' +
				'<span class="jod-region-state-name">' + esc(state.name) + "</span>" +
				'<span class="jod-region-count">' + state.districts.length + (state.districts.length === 1 ? " district" : " districts") + "</span>" +
				'<svg class="jod-region-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
				"</button>" +
				(isOpen
					? '<div class="jod-region-districts">' +
						'<button type="button" class="jod-region-chip is-whole' + (isCurrent && !current.district ? " is-on" : "") + '" data-pick-state="' + state.code + '">All of ' + esc(state.name) + "</button>" +
						list.map(function (d) { return districtChip(d, current); }).join("") +
						"</div>"
					: "") +
				"</div>";
		}).join("");
		root.querySelector("#jodRegionList").innerHTML = html;
		root.querySelector("#jodRegionEmpty").hidden = shown > 0;
		root.querySelector("#jodRegionStatesHead").hidden = shown === 0;
	}

	function toggleState(code) {
		openCode = openCode === code ? null : code;
		render();
		if (openCode) {
			var row = root.querySelector('[data-state-toggle="' + code + '"]');
			if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	}

	function locate() {
		if (!navigator.geolocation) return setStatus("Location isn't available in this browser. Choose a state below.");
		var btn = root.querySelector("#jodRegionLocate");
		btn.disabled = true;
		setStatus("Finding where you are\u2026");
		navigator.geolocation.getCurrentPosition(function (pos) {
			var url = apiBase() + "/api/location/region?lat=" + encodeURIComponent(pos.coords.latitude) + "&lon=" + encodeURIComponent(pos.coords.longitude);
			fetch(url).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; }).then(function (data) {
				btn.disabled = false;
				var state = data && data.state ? stateOfName(data.state) : null;
				if (!state) return setStatus("We couldn't match your location to an Indian state. Choose one below.");
				var district = data.district ? (districtIn(state, data.district) || state.districts.filter(function (d) { return keyMatches(d.keys, data.district); })[0]) : null;
				setStatus("");
				choose(state.code, district ? district.name : null);
			});
		}, function () {
			btn.disabled = false;
			setStatus("Location permission was blocked. Choose a state below.");
		}, { timeout: 10000, maximumAge: 600000 });
	}

	function open() {
		ensureCss().then(function () {
			build();
			lastFocus = document.activeElement;
			var current = getRegion();
			openCode = current ? current.state.code : null;
			root.querySelector("#jodRegionSearch").value = "";
			setStatus("");
			render();
			root.hidden = false;
			document.documentElement.classList.add("jod-region-open");
			requestAnimationFrame(function () {
				root.classList.add("is-open");
				root.querySelector("#jodRegionSearch").focus({ preventScroll: true });
				var body = root.querySelector(".jod-region-body");
				var row = openCode && root.querySelector('[data-state-toggle="' + openCode + '"]');
				if (body && row) body.scrollTop = Math.max(0, row.parentElement.offsetTop - body.offsetTop - 12);
			});
		});
	}

	function close() {
		if (!root) return;
		root.classList.remove("is-open");
		document.documentElement.classList.remove("jod-region-open");
		setTimeout(function () { root.hidden = true; }, 220);
		if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
	}

	function paintHeader() {
		var sel = getRegion();
		document.documentElement.toggleAttribute("data-city-selected", Boolean(sel));
		document.querySelectorAll("[data-city-label]").forEach(function (el) {
			el.textContent = sel ? sel.label : "All of India";
		});
		document.querySelectorAll("[data-city-open]").forEach(function (btn) {
			btn.setAttribute("aria-label", sel ? "Showing events in " + sel.label + ". Change location" : "Choose a state and district");
			btn.title = sel ? "Showing events in " + sel.label : "Choose a state and district";
		});
	}

	function choose(code, districtName) {
		var state = code ? stateByCode(code) : null;
		var district = state && districtName ? districtIn(state, districtName) : null;
		try {
			if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: state.code, district: district ? district.name : null }));
			else localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
		} catch (_) {}
		paintHeader();
		close();
		try { global.dispatchEvent(new CustomEvent("jod:city-changed", { detail: { city: getRegion() } })); } catch (_) {}
	}

	function bindHeader() {
		var buttons = document.querySelectorAll("[data-city-open]");
		if (!buttons.length) return false;
		ensureCss().then(function () {
			buttons.forEach(function (btn) {
				if (btn.dataset.cityBound === "1") return;
				btn.dataset.cityBound = "1";
				btn.hidden = false;
				btn.addEventListener("click", function (e) {
					e.preventDefault();
					open();
				});
			});
			paintHeader();
		});
		return true;
	}

	var api = {
		STATES: STATES,
		getRegion: getRegion,
		getCity: getRegion,
		hasChosen: hasChosen,
		setRegion: choose,
		setCity: function (value) { if (!value) choose(null, null); },
		matchesEvent: matchesEvent,
		filterEvents: filterEvents,
		stateOfName: stateOfName,
		open: open
	};
	global.JodRegionPicker = api;
	global.JodCityPicker = api;

	if (!bindHeader()) {
		global.addEventListener("includesLoaded", bindHeader);
		(global.includesReady || Promise.resolve()).then(function () { setTimeout(bindHeader, 0); });
	}
	paintHeader();
	if (getRegion()) {
		try { global.dispatchEvent(new CustomEvent("jod:city-changed", { detail: { city: getRegion(), initial: true } })); } catch (_) {}
	}
})(window);
