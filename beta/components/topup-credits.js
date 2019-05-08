const html = require('choo/html')
const css = require('sheetify')
const nanostate = require('nanostate')
const icon = require('@resonate/icon-element')
const button = require('@resonate/button')
const Component = require('choo/component')
const PaymentMethods = require('./payment-methods')
const nanologger = require('nanologger')
const log = nanologger('topup-credits')
const vatEu = require('../lib/country-codes')

const iconStyle = css`
  :host {
    border: solid 1px var(--mid-gray);
    width: 28px;
    height: 28px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
`

const lineStyle = css`
  :host {
    border: solid 1px var(--mid-gray);
  }
`

const tableStyles = css`
:host input[type="radio"] {
  opacity: 0;
  width: 0;
  height: 0;
}
:host input[type="radio"]:active ~ label {
  opacity: 1;
}
:host input[type="radio"]:checked ~ label {
  opacity: 1;
}
:host input[type="radio"]:checked ~ label .icon {
  fill: var(--dark-gray);
}
:host label {
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}
:host label .icon {
  fill: transparent;
}
:host label:hover {
  opacity: .5;
}
`

const prices = [
  {
    amount: 5,
    tokens: '4.0880',
    checked: true
  },
  {
    amount: 10,
    tokens: '8.1760'
  },
  {
    amount: 20,
    tokens: '16.3520'
  },
  {
    amount: 50,
    tokens: '40.8800'
  },
  {
    amount: 100,
    tokens: '81.760'
  }
]

class Credits extends Component {
  constructor (name, state, emit) {
    super(name)

    this.state = state
    this.emit = emit

    this.renderPayment = this.renderPayment.bind(this)
    this.renderRecap = this.renderRecap.bind(this)
    this.renderList = this.renderList.bind(this)
    this.renderCheckout = this.renderCheckout.bind(this)

    this.machine = nanostate('list', {
      list: { next: 'payment' },
      payment: { next: 'recap', prev: 'list' },
      recap: { next: 'checkout', prev: 'payment' },
      checkout: { next: 'list' }
    })

    this.machine.on('payment', () => {
      log.info('payment', this.machine.state)
      this.rerender()
    })

    this.machine.on('recap', () => {
      log.info('recap', this.machine.state)
      this.rerender()
    })

    this.machine.on('list', () => {
      log.info('list', this.machine.state)
      this.rerender()
    })

    this.machine.on('checkout', async () => {
      log.info('checkout', this.machine.state)
      const amount = 100 * this.data.amount

      try {
        const response = await this.state.api.payments.charge({
          uid: this.state.user.uid,
          tok: this.token.id, // stripe token
          amount: this.vat ? 1.23 * amount : amount,
          currency: this.currency,
          vat: this.vat
        })

        this.checkoutResult = {}

        if (!response.data) {
          this.checkoutResult.errorMessage = response.message
          this.checkoutResult.status = 'failed'

          this.emit('notify', { type: 'error', message: response.message })
        } else {
          this.checkoutResult.errorMessage = null
          this.checkoutResult.status = 'success'
        }

        this.rerender()
      } catch (err) {
        log.error(err.message)
      }
    })

    this.index = 0
    this.vat = 0
    this.currency = 'EUR'
    this.data = prices[this.index]
  }

  createElement () {
    const template = {
      'list': this.renderList,
      'payment': this.renderPayment,
      'recap': this.renderRecap,
      'checkout': this.renderCheckout
    }[this.machine.state]

    return template()
  }

  renderCheckout () {
    const self = this
    const { status, errorMessage } = this.checkoutResult
    // const { tokens } = prices.find(({ amount }) => amount === this.data.amount)

    const title = {
      'success': 'Payment confirmed',
      'failed': 'Payment not confirmed'
    }[status]

    const nextButton = button({
      onClick: function (e) {
        e.preventDefault()
        e.stopPropagation()
        self.machine.emit('next')
        return false
      },
      type: 'button',
      text: 'Try again',
      size: 'none'
    })

    const closeButton = button({
      value: status,
      type: 'submit',
      text: 'Ok',
      size: 'none'
    })

    const message = errorMessage
      ? renderMessage(errorMessage)
      : renderMessage([
        'Your credits have been topped up.',
        'We\'re very eager to learn how you find the #stream2own experience. Reach out through the support page any time to share your thoughts.'
      ])

    return html`
      <div class="tunnel">
        <div id="payment-errors"></div>
        <div class="flex flex-column">
          <h2 class="lh-title f3">${title}</h2>
          ${message}
          <div class="flex flex-auto justify-between mt3">
            ${status === 'failed' ? nextButton : ''}
            ${closeButton}
          </div>
        </div>
      </div>
    `
  }

  renderPayment () {
    const self = this
    const paymentMethods = this.state.cache(PaymentMethods, 'payment-methods').render({
      prev: function (e) {
        e.preventDefault()
        self.machine.emit('prev')
        return false
      },
      submit: async function charge (e, { element: cardElement, tokenData }) {
        e.preventDefault()
        e.stopPropagation()

        try {
          const response = await self.state.stripe.createToken(
            cardElement,
            tokenData
          )

          if (!response.error) {
            self.token = response.token
            return self.machine.emit('next')
          }

          return self.emit('notify', {
            type: 'error',
            message: response.error.message
          })
        } catch (err) {
          log.error(err.message)
        }
      }
    })

    return html`
      <div class="tunnel">
        <div class="flex flex-column">
          <p class="f3">Payment</p>
          <div id="card-errors"></div>
          ${paymentMethods}
        </div>
      </div>
    `
  }

  renderRecap () {
    const self = this
    const amount = this.data.amount

    if (this.token && this.token.card) {
      // Add 23% VAT if credit card from EU given country code in self.token
      if (vatEu.indexOf(this.token.card.country) > -1) {
        this.vat = 1
      }
      if (this.token.card.country === 'US') {
        this.currency = 'USD'
        // TODO convert to USD
      }
    }

    const prevButton = button({
      onClick: function (e) {
        e.preventDefault()
        e.stopPropagation()
        self.machine.emit('prev')
        return false
      },
      type: 'button',
      text: 'Back',
      size: 'none'
    })

    const nextButton = button({
      onClick: function (e) {
        e.preventDefault()
        e.stopPropagation()
        self.machine.emit('next')
        return false
      },
      type: 'button',
      text: 'Check out',
      size: 'none'
    })

    const currency = this.currency === 'EUR' ? '€' : '$'
    const vat = this.vat ? 0.23 * amount : 0

    return html`
      <div class="${tableStyles} tunnel">
        <p class="f3">Invoice</p>
        <div class="flex flex-auto pa3">
          <div class="flex w-100 mid-gray flex-auto">
            Subtotal
          </div>
          <div class="flex w-100 flex-auto justify-end">
            ${currency}${amount}
          </div>
        </div>
        <div class="flex flex-auto pa3">
          <div class="flex w-100 mid-gray flex-auto">
            VAT
          </div>
          <div class="flex w-100 flex-auto justify-end">
            ${currency}${vat}
          </div>
        </div>
        <div class="${lineStyle}"></div>
        <div class="flex flex-auto pa3">
          <div class="flex w-100 mid-gray flex-auto">
            Total
          </div>
          <div class="flex w-100 flex-auto justify-end">
            ${currency}${vat + amount}
          </div>
        </div>
        <div class="flex flex-auto justify-between mt3">
          ${prevButton}
          ${nextButton}
        </div>
      </div>
    `
  }

  renderList () {
    const self = this
    const nextButton = button({
      onClick: function (e) {
        e.preventDefault()
        e.stopPropagation()
        self.machine.emit('next')
        return false
      },
      type: 'button',
      text: 'Next',
      size: 'none'
    })

    return html`
      <div class="${tableStyles} tunnel">
        <div class="flex flex-column">
          <p class="f3">Add Credits</p>
          <p class="f4">How much would you like to top up?</p>
          <div class="flex">
            <div class="pa3 flex w-100 flex-auto">
            </div>
            <div class="pa3 flex w-100 flex-auto">
            </div>
            <div class="pa3 flex w-100 flex-auto f4 mid-gray">
              Credits
            </div>
          </div>
          ${prices.map(priceItem)}
        </div>
        ${nextButton}
      </div>
    `

    function priceItem (item, index) {
      const { amount, tokens } = item

      return html`
        <div class="flex w-100 flex-auto">
          <input onchange=${updateSelection} id=${'amount-' + index} name="amount" type="radio" checked=${amount === self.data.amount} value=${amount} />
          <label tabindex="0" onkeypress=${handleKeyPress} for=${'amount-' + index}>
            <div class="pa3 flex w-100 flex-auto">
              <div class="${iconStyle}">
                ${icon('circle', { 'class': 'icon icon--xs' })}
              </div>
            </div>
            <div class="pa3 flex w-100 flex-auto f3">
              €${amount}
            </div>
            <div class="pa3 flex w-100 flex-auto f3 dark-gray">
              ${tokens}
            </div>
          </label>
        </div>
      `
    }

    function updateSelection (e) {
      const val = parseInt(e.target.value, 10)
      log.info(`select:${val}`)
      const index = prices.findIndex((item) => item.amount === val)
      self.data = prices[index]
    }

    function handleKeyPress (e) {
      if (e.keyCode === 13) {
        e.preventDefault()
        e.target.control.checked = !e.target.control.checked
        const val = parseInt(e.target.control.value, 10)
        const index = prices.findIndex((item) => item.amount === val)
        self.data = prices[index]
      }
    }
  }

  update () {
    return false
  }
}

function renderMessage (text) {
  return html`
    <article>
      ${Array.isArray(text) ? text.map(line => html`<p class="pa0 pb3">${line}</p>`) : html`<p class="pa0 pb3">${text}</p>`}
    </article>
  `
}

module.exports = Credits
