import dns from 'dns'
dns.setDefaultResultOrder('ipv4first') //required for resolving correctly localhost
jest.setTimeout(30000) // in milliseconds
