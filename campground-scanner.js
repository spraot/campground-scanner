var Pushover = require('pushover-js').Pushover;
const credentials = require('./config/credentials.json');
const searches = require('./config/searches.json');
const pushover = () => new Pushover(credentials.pushover.adminGroup, credentials.pushover.token);
const fetch = require("./waf-fetch");

let notify = async (title, message, url, priority) => await pushover().setUrl(url).setPriority(priority).send(title, message);
if (require.main === module) {
  notify = async (title, message, url) => console.log(title, message, url);
}
const URLSearchParams = require('url').URLSearchParams

const commonParams = {
    partySize: 5,
    numEquipment: 1,
}

const searchParams = {
    ...commonParams,
    equipmentCategoryId: -32768,
    getDailyAvailability: false,
}

const canadaSearchParams = Object.assign({}, searchParams, {
    subEquipmentCategoryId: -32760,
    // filterData: '[]'
    filterData: '[{"attributeDefinitionId":-32582,"attributeType":0,"enumValues":[1],"attributeDefinitionDecimalValue":0,"filterStrategy":1},{"attributeDefinitionId":-32756,"attributeType":0,"enumValues":[1],"attributeDefinitionDecimalValue":0,"filterStrategy":1}]'
})

const bcSearchParams = Object.assign({}, searchParams, {
    subEquipmentCategoryId: -32763,
    // filterData: '[]'
    // Only with electricity:
    // filterData: '[{"attributeDefinitionId":-32767,"attributeType":0,"enumValues":[1,2,3,4],"attributeDefinitionDecimalValue":0,"filterStrategy":1}]'
    filterData: '[{"-32767":"[[1,2,3,4],0,1,0]","-32764":"[[-1],0,1,0]","-32722":"[[-1],0,1,0]"}]'
})

const bookingParams = {
    ...commonParams,
    bookingCategoryId: 0,
    equipmentId: searchParams.equipmentCategoryId,
    isReserving: true,
    flexibleSearch: '[false,false,null,1]',
}

const canadaBookingParams = Object.assign({}, commonParams, bookingParams, {
    subEquipmentId: canadaSearchParams.subEquipmentCategoryId,
})

const bcBookingParams = Object.assign({}, commonParams, bookingParams, {
    equipmentCategoryId: bookingParams.equipmentId,
    subEquipmentId: bcSearchParams.subEquipmentCategoryId,
    subEquipmentCategoryId: bcSearchParams.subEquipmentCategoryId,
})

const canadaBaseUrl = 'https://reservation.pc.gc.ca/'
const bcBaseUrl = 'https://camping.bcparks.ca/'

function resolveBaseUrl(key) {
    if (key === 'canada') return canadaBaseUrl;
    if (key === 'bc') return bcBaseUrl;
    throw new Error(`Unknown baseUrl key: "${key}"`);
}
const searchUrl = `api/availability/map`
const bookingUrl = `create-booking/results`
const resourceLocationUrl = `api/resourceLocation`
const changeBookingUrl = 'account/all-bookings'

// Cache of resourceLocation data per origin, keyed by base URL
const resourceLocationCache = {}

async function update() {
    for (const search of searches) {
        const baseUrl = resolveBaseUrl(search.baseUrl);
        const label = search.name || `${search.mapId} (${search.startDate} - ${search.endDate})`;
        const type = search.type || 'map';

        if (type === 'site') {
            await checkSiteAvailability(baseUrl, search.mapId, search.siteId, search.startDate, search.endDate, label);
        } else {
            await findAvailableSite(baseUrl, search.mapId, search.startDate, search.endDate, label);
        }
    }
}

async function getResourceLocations(baseUrl) {
    if (!resourceLocationCache[baseUrl]) {
        const response = await fetch(baseUrl + resourceLocationUrl);
        resourceLocationCache[baseUrl] = await response.json();
    }
    return resourceLocationCache[baseUrl];
}

function findResourceLocation(locations, searchName) {
    if (!searchName) return null;
    const lower = searchName.toLowerCase();
    return locations.find(loc => {
        const en = loc.localizedValues?.find(l => l.cultureName.startsWith('en'));
        return en?.fullName?.toLowerCase().includes(lower)
            || en?.shortName?.toLowerCase().includes(lower);
    }) || null;
}

async function checkSiteAvailability(baseUrl, mapId, siteId, startDate, endDate, searchName) {
    return fetch(baseUrl+searchUrl + '?' + new URLSearchParams(Object.assign({ mapId }, baseUrl == canadaBaseUrl ? canadaSearchParams : bcSearchParams, {startDate, endDate})))
        .then(response => response.json())
        .then(async data => {
            if (data.resourceAvailabilities[siteId][0].availability == 0) {
                const label = searchName || `Site ${siteId}`;
                notify(`Campsite ${label} available!`, '', baseUrl+changeBookingUrl, 1)
            }
        })
}


async function checkAvailability(baseUrl, mapId, startDate, endDate) {
    const url = baseUrl+searchUrl + '?' + new URLSearchParams(Object.assign({ mapId }, baseUrl == canadaBaseUrl ? canadaSearchParams : bcSearchParams, {startDate, endDate}))
    return fetch(url)
        .then(response => response.json())
        .then(data => {
            const maps = data.mapLinkAvailabilities || {}
            const campgrounds = data.resourceAvailabilities || {}
            return {
                mapId: mapId,
                campgrounds: Object.entries(campgrounds).filter(m => m[1][0].availability == 0).map(m => [mapId, m[0]]),
                maps: Object.keys(maps).filter(m => maps[m][0] == 0),
            }
        })
}

async function checkMapRecursive(baseUrl, mapId, startDate, endDate) {
    const campgrounds = []
    const result = await checkAvailability(baseUrl, mapId, startDate, endDate)
    campgrounds.push(...result.campgrounds)
    for (const m of result.maps) {
        campgrounds.push(...await checkMapRecursive(baseUrl, m, startDate, endDate))
    }
    return campgrounds
}

const errors = {}

async function findAvailableSite(baseUrl, mapId, startDate, endDate, searchName) {
    try {
        const locations = await getResourceLocations(baseUrl);
        const location = findResourceLocation(locations, searchName);
        const resourceLocationId = location?.resourceLocationId || '';

        const campgrounds = await checkMapRecursive(baseUrl, mapId, startDate, endDate)
        for (const m of campgrounds) {
            const label = searchName || `Map ${m[0]}`;
            const url = baseUrl + bookingUrl + '?' + new URLSearchParams(Object.assign({ mapId: m[0], resourceLocationId }, baseUrl == canadaBaseUrl ? canadaBookingParams : bcBookingParams, {startDate, endDate}))
            await notify('Campground available!', label, url, 1)
        }
    } catch (e) {
        if (errors[e.message] > new Date() - 30*60*1000) {
            // do nothing
        } else {
            await notify('Error searching for campground', e.message, null, -1)
            errors[e.message] = new Date()
        }
    }
}

async function loop() {
  try {
    await update();
  } catch (e) {
    console.error('Update failed:', e.message);
  }
  setTimeout(loop, 60*1000);
}

if (require.main === module) {
  update();
} else {
  loop();
}