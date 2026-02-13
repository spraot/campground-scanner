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

const shuttleParams = {
    searchParams: {
        bookingCategoryId: 9, 
        filterData: '', 
        bookingUid: '2765bac6-2a1f-4735-a47c-691f3c5d5629',
        cartUid: '2765bac6-2a1f-4735-a47c-691f3c5d5629',
        isReserving: true,
        partySize: 3,
    }, 
    bookingParams: {
        bookingCategoryId: 9, 
        flexibleSearch: '',
        partySize: 3,
    }
}

const canadaBaseUrl = 'https://reservation.pc.gc.ca/'
const bcBaseUrl = 'https://camping.bcparks.ca/'

function resolveBaseUrl(key) {
    if (key === 'canada') return canadaBaseUrl;
    if (key === 'bc') return bcBaseUrl;
    throw new Error(`Unknown baseUrl key: "${key}"`);
}
const searchUrl = `api/availability/map`
const bookingUrl = `create-booking/results`
const campDetailsUrl = `api/maps/mapdatabyid`
const siteDetailsUrl = `api/resource/details`
const changeBookingUrl = 'account/all-bookings'

const mapNames = {}
const siteNames = {}

async function update() {
    for (const search of searches) {
        const baseUrl = resolveBaseUrl(search.baseUrl);
        const label = search.name || `${search.mapId} (${search.startDate} - ${search.endDate})`;
        const type = search.type || 'map';

        if (type === 'site') {
            checkSiteAvailability(baseUrl, search.mapId, search.siteId, search.startDate, search.endDate);
        } else {
            findAvailableSite(baseUrl, search.mapId, search.startDate, search.endDate);
        }
    }
}

async function checkSiteAvailability(baseUrl, mapId, siteId, startDate, endDate, opts) {
    opts = opts || {}
    return fetch(baseUrl+searchUrl + '?' + new URLSearchParams(Object.assign({ mapId }, baseUrl == canadaBaseUrl ? canadaSearchParams : bcSearchParams, {startDate, endDate, ...opts?.searchParams})))
        .then(response => response.json())
        .then(async data => {
            if (data.resourceAvailabilities[siteId][0].availability == 0) {
                notify(`Campside ${await getSiteName(baseUrl, siteId).name} at ${await getMapName(baseUrl, mapId)} available!`, '', baseUrl+changeBookingUrl, 1)
            }
        })
}

async function getSiteName(baseUrl, resourceId, opts) {
    if (!siteNames[resourceId]) {
        try {
            siteNames[resourceId] = await fetch(baseUrl+siteDetailsUrl + '?' + new URLSearchParams({ resourceId }))
                .then(response => response.json())
                .then(data => {return {resourceLocationId: data.resourceLocationId, name: getLocalizedName(data.localizedValues)}})
        } catch (e) {
            console.error(`Couldn't get site name for resource ID ${resourceId} due to error ${e}`)
            return {resourceLocationId: '', name: ''};
        }
    }
    return siteNames[resourceId];
}

function getLocalizedName(localizedValues) {
    // return undefined if localizedValues is not iterable
    if (!localizedValues?.[Symbol.iterator]) {
        return;
    }

    for (const value of localizedValues) {
        if (value.cultureName.startsWith('en')) {
            return value.name || value.title;
        }
    }
}

async function getMapName(baseUrl, mapId, opts) {
    if (!mapNames[mapId]) {
        const names = []
        try {
            const mapData = await fetch(baseUrl+campDetailsUrl, 
                {
                    method: 'post', 
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({mapId})
                })
            .then(response => response.json())
            const title = getLocalizedName(mapData.map?.localizedValues)
            if (title) {
                names.push(title)
            }   

            if (mapData.map?.parentMaps?.length) {
                names.unshift(await getMapName(baseUrl, mapData.map.parentMaps[0], opts))
            }    
        } catch (e) {
            console.error(`Couldn't get map name for resource ID ${mapId} due to error ${e}`)
            return names.join(' - ')
        }
        mapNames[mapId] = names.join(' - ')
    }
    return mapNames[mapId]
}


async function checkAvailability(baseUrl, mapId, startDate, endDate, opts) {
    const url = baseUrl+searchUrl + '?' + new URLSearchParams(Object.assign({ mapId }, baseUrl == canadaBaseUrl ? canadaSearchParams : bcSearchParams, {startDate, endDate, ...opts?.searchParams}))
    return fetch(url)
        .then(response => response.json())
        .then(data => {
            console.log(url, JSON.stringify(data).substring(0, 200))
            return data
        })
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

async function checkMapRecursive(baseUrl, mapId, startDate, endDate, opts) {
    const campgrounds = []
    const result = await checkAvailability(baseUrl, mapId, startDate, endDate, opts)
    campgrounds.push(...result.campgrounds)
    for (const m of result.maps) {
        campgrounds.push(...await checkMapRecursive(baseUrl, m, startDate, endDate, opts))
    }
    return campgrounds
}

const errors = {}

async function findAvailableSite(baseUrl, mapId, startDate, endDate, opts) {
    opts = opts || {}
    try {
        const campgrounds = await checkMapRecursive(baseUrl, mapId, startDate, endDate, opts)
        for (const m of campgrounds) {
            const siteDetails = await getSiteName(baseUrl, m[1], opts)
            const name = await getMapName(baseUrl, m[0], opts) + ' - ' + siteDetails.name
            if (name?.includes('(Last Minute)')) continue;
            if (opts?.resourceLocationIdsToSkip?.includes(siteDetails.resourceLocationId)) continue;
            const url = baseUrl + bookingUrl + '?' + new URLSearchParams(Object.assign({ mapId: m[0], resourceLocationId: siteDetails.resourceLocationId }, baseUrl == canadaBaseUrl ? canadaBookingParams : bcBookingParams, {startDate, endDate, ...opts?.bookingParams}))
            await notify('Campground available!', `${name}`, url, 1)
        }
        if (!campgrounds.length) {
            // console.log('No campgrounds available')
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

update();
if (require.main !== module) {
  setInterval(update, 60*1000);
}