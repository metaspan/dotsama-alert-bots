
export class Candidate {
  valid = false
  validity = []
  invalidityReasons = ''
  active = false

  constructor (data) {
    // Object.keys(data).forEach(k => {
    //     this[k] = data[k]
    // })
    Object.assign(this, data)
  }

  checkValid () {
    return this.valid
      ? this.valid
      : this.validity.filter(f => f.valid === false).length > 0    
  }

}
